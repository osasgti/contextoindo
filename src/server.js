// HTTP + WebSocket server.
//   /          overlay (OBS Browser Source)   ?layout=portrait for 1080x1920
//   /control   streamer control page: shows the answer, never add it to OBS
//   /ws        live updates. Overlays get the public state only; the secret goes to control clients.
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WsServer } from './net/ws.js';
import { loadConfig, ROOT } from './config.js';
import { loadKbbi } from './kbbi.js';
import { buildTiers, loadOptionalList, loadSecrets } from './secrets.js';
import { loadVectors } from './game/vectors.js';
import { Game, PHASE } from './game/game.js';
import { ScoreStore } from './scores.js';
import { SettingsStore } from './settings.js';
import { SimSource } from './live/sim.js';
import { StreamchimeSource } from './live/streamchime.js';
import { RotatingLog } from './eventlog.js';
import { HealthMonitor } from './health.js';

const PUBLIC = path.join(ROOT, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};
const LOG_MAX = 120;

/**
 * Build the app without listening, so tests can drive it.
 * @returns {{ server: http.Server, game: Game, close(): Promise<void>, ... }}
 */
export function createApp({ config, dict, secrets, tiers = null, vectors = null, now = () => Date.now(), log = console.log, liveSource = null }) {
  const scores = new ScoreStore(config.dataDir ? path.join(config.dataDir, 'scores.json') : null, { now });
  const settingsStore = new SettingsStore(config.dataDir ? path.join(config.dataDir, 'settings.json') : null, { hintGift: config.hintGift });
  const settings = settingsStore.values;
  const game = new Game({ dict, secrets, tiers, vectors, settings, scores, now, streamer: config.tiktokUsername });
  const ws = new WsServer();
  const overlays = new Set();
  const controls = new Set();
  const activity = [];
  const overlayAudio = new Map();
  // the simulator guesses real words that have vectors, so its guesses can be ranked
  const simWords = vectors?.words?.length ? vectors.words : [...(dict.words ?? [])].filter((w) => /^[a-z]{3,10}$/.test(w));
  const sim = new SimSource({ game, words: simWords, intensity: config.simIntensity });
  const live = liveSource ?? new StreamchimeSource({ appKey: config.streamchimeKey, username: config.tiktokUsername, log, debug: config.debugLive });

  const health = new HealthMonitor({ now });
  health.start();
  const elog = new RotatingLog(config.dataDir && config.eventLog !== false ? path.join(config.dataDir, 'logs') : null, {
    now,
    onError: (err) => log(`[log] event log stopped: ${err.message}`),
  });

  const pushLog = (kind, text) => {
    const entry = { at: now(), kind, text };
    activity.push(entry);
    if (activity.length > LOG_MAX) activity.shift();
    elog.write('log', { what: kind, text });
    sendAll(controls, { t: 'log', entry });
  };

  // ------------------------------------------------------------------ sources -> game
  const wire = (src) => {
    src.on('chat', (user, text) => {
      health.noteEvent();
      const status = game.handleChat(user, text);
      if (status === 'guess' || status === 'win') pushLog(status, `${user.name}: ${text.trim()}`);
      if (status === 'streamer') pushLog('admin', `Tebakan benar dari akun streamer (${user.name}) diabaikan. Aktifkan di Pengaturan jika mau.`);
      if (status !== 'ignored') elog.write('chat', { user: user.id, name: user.name, sim: user.sim || undefined, text: String(text).slice(0, 120), status });
    });
    src.on('join', (user) => (health.noteEvent(), game.handleEnter(user)));
    src.on('follow', (user) => (health.noteEvent(), game.handleFollow(user) === 'follow' && pushLog('follow', `${user.name} mengikuti`)));
    src.on('like', (user, count) => (health.noteEvent(), queueLike(user, count)));
    src.on('gift', (user, name, count) => {
      health.noteEvent();
      const status = game.handleGift(user, name, count);
      pushLog('gift', `${user.name} mengirim ${name}${count > 1 ? ` x${count}` : ''}${status === 'hint' ? ' → huruf terbuka' : ''}`);
    });
  };
  wire(sim);
  wire(live);
  game.on('reply', ({ user, text, word }) => {
    // TikTok has no private replies for apps; the adapter says if it sent one.
    const sent = (user.sim ? sim : live).reply(user, text);
    pushLog('reply', `${user.name}: "${word}" → ${text}${sent ? '' : ' (tidak terkirim: TikTok tidak mendukung balasan pribadi)'}`);
  });
  live.on('status', (status) => {
    pushLog('live', `LIVE: ${status}`);
    if (live.live && sim.running) {
      sim.stop();
      pushLog('sim', 'Simulator dimatikan karena LIVE tersambung.');
    }
    scheduleState();
  });

  // likes arrive in bursts: send one heart burst per 400 ms
  let likeBuf = 0;
  let likeTimer = null;
  const queueLike = (user, count) => {
    likeBuf += count;
    if (likeTimer) return;
    likeTimer = setTimeout(() => {
      likeTimer = null;
      const n = likeBuf;
      likeBuf = 0;
      elog.write('likes', { count: n });
      sendEvt({ type: 'like', count: n });
    }, 400);
    likeTimer.unref?.();
  };

  // ------------------------------------------------------------------ game -> clients
  const sendAll = (set, msg) => {
    const s = JSON.stringify(msg);
    for (const c of set) if (c.buffered < 4 * 1024 * 1024) c.send(s);
  };
  const sendEvt = (evt) => {
    sendAll(overlays, { t: 'evt', evt });
    sendAll(controls, { t: 'evt', evt });
  };
  game.on('evt', (evt) => {
    if (evt.type === 'like') return; // batched above
    if (evt.type === 'round') pushLog('round', `Ronde ${evt.no} dimulai`);
    if (evt.type === 'win') pushLog('win', `${evt.winner.name} menebak "${evt.word}" (+${evt.points.total})`);
    if (evt.type === 'reveal') pushLog('reveal', `Jawaban "${evt.word}" dibuka (${evt.reason})`);
    if (evt.type === 'hint' && evt.kind === 'first') pushLog('hint', 'Huruf pertama dibuka');
    if (evt.type === 'join') pushLog('join', `${evt.user.name} ikut main`);
    if (evt.type === 'close') pushLog('close', `Hampir! ${evt.entry.user.name}: ${evt.entry.word}`);
    if (evt.type === 'hot') pushLog('hot', `Tebakan ramai: ${evt.count} dalam ${evt.windowMs / 1000} detik`);
    if (evt.type === 'hint' && evt.kind === 'free') pushLog('hint', `${evt.user.name} memakai !hint`);
    if (evt.type !== 'scores') elog.write('evt', { evt });
    sendEvt(evt);
    scheduleState();
  });
  game.on('changed', () => scheduleState());
  game.on('note', ({ text }) => pushLog('admin', text));

  const overlaySettings = () => ({
    lang: settings.lang,
    layout: settings.layout,
    sound: settings.sound,
    musicVol: settings.musicVol,
    sfxVol: settings.sfxVol,
    tts: settings.tts,
    boardTop: settings.boardTop,
    hintGift: settings.hintGift,
    cooldownMs: settings.cooldownMs,
    freeHint: settings.freeHint,
    reduceFlash: settings.reduceFlash,
    sceneSafe: settings.sceneSafe,
    mutedFx: settings.mutedFx,
  });
  const status = () => ({
    live: live.live,
    liveStatus: live.status ?? (live.live ? 'live' : 'off'),
    liveConfigured: !!(config.streamchimeKey && config.tiktokUsername),
    username: config.tiktokUsername || null,
    sim: sim.running,
    overlays: overlays.size,
    overlayAudio: [...overlayAudio.values()],
    health: { ...health.snapshot(), controls: controls.size, overlays: overlays.size, reconnects: live.reconnects ?? 0, logging: elog.enabled },
  });
  const sendState = (c) => c.send(JSON.stringify(controls.has(c) ? controlMsg() : overlayMsg()));
  const overlayMsg = () => ({ t: 'state', state: game.publicState(), settings: overlaySettings() });
  const controlMsg = () => ({
    t: 'state',
    state: game.controlState(),
    settings: { ...settings },
    status: status(),
    alltime: scores.top(25),
    alltimeCount: scores.count,
  });
  let stateTimer = null;
  const scheduleState = () => {
    if (stateTimer) return;
    stateTimer = setTimeout(flushState, 60);
    stateTimer.unref?.();
  };
  const flushState = () => {
    clearTimeout(stateTimer);
    stateTimer = null;
    if (overlays.size) sendAll(overlays, overlayMsg());
    if (controls.size) sendAll(controls, controlMsg());
  };

  // ------------------------------------------------------------------ control actions
  const actions = {
    start: () => {
      if (game.frozen) return { ok: false, error: 'panic' };
      if (game.phase === PHASE.PLAYING) return { ok: false, error: 'already-playing' };
      game.startRound();
      return { ok: true };
    },
    skip: () => (game.frozen ? { ok: false, error: 'panic' } : (game.skip(), { ok: true })),
    reveal: () => (game.frozen ? { ok: false, error: 'panic' } : { ok: game.reveal() }),
    // Panic: stop sound, freeze the round and hide the answer on the overlay and here, until resumed
    panic: ({ on } = {}) => {
      const want = on ?? !game.frozen;
      if (want) game.freeze();
      else game.unfreeze();
      pushLog('admin', want ? 'PANIK: ronde dibekukan, jawaban disembunyikan' : 'Panik dimatikan, ronde berlanjut');
      return { ok: true, panic: game.frozen };
    },
    resetSession: () => (game.resetSession(), pushLog('admin', 'Sesi direset'), { ok: true }),
    clearBoard: () => (game.clearLeaderboard(), pushLog('admin', 'Papan skor sesi dibersihkan'), { ok: true }),
    resetAllTime: ({ confirm }) => {
      if (confirm !== 'HAPUS') return { ok: false, error: 'confirm' };
      scores.reset();
      pushLog('admin', 'Papan sepanjang masa direset');
      return { ok: true };
    },
    sim: ({ on }) => {
      const want = on ?? !sim.running;
      if (want && live.live) {
        pushLog('sim', 'Simulator tidak bisa jalan saat LIVE tersambung.');
        return { ok: false, error: 'live' };
      }
      if (want) sim.start();
      else sim.stop();
      pushLog('sim', want ? 'Simulator menyala' : 'Simulator mati');
      return { ok: true };
    },
    setNext: ({ word }) => {
      if (game.frozen) return { ok: false, error: 'panic' };
      const r = game.setNextWord(word);
      if (r.ok) pushLog('admin', r.word ? `Kata berikutnya diatur: ${r.word}` : 'Kata berikutnya: acak');
      return r;
    },
  };

  const applySettings = (patch) => {
    const changed = settingsStore.update(patch);
    scheduleState();
    return changed;
  };

  // ------------------------------------------------------------------ HTTP
  const keyOk = (url) => !config.controlKey || url.searchParams.get('key') === config.controlKey;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/alltime.csv') {
      if (!keyOk(url)) return send(res, 403, 'text/plain', 'Forbidden');
      res.setHeader('Content-Disposition', `attachment; filename="wordleindo-skor-${new Date(now()).toISOString().slice(0, 10)}.csv"`);
      return send(res, 200, 'text/csv; charset=utf-8', '﻿' + scores.toCsv());
    }
    if (url.pathname === '/health') return send(res, 200, 'application/json', JSON.stringify({ ok: true, phase: game.phase }));
    let file = url.pathname === '/' ? '/index.html' : url.pathname === '/control' ? '/control.html' : url.pathname;
    if (file === '/control.html' && !keyOk(url)) return send(res, 403, 'text/plain', 'Forbidden: add ?key=CONTROL_KEY');
    const full = path.normalize(path.join(PUBLIC, decodeURIComponent(file)));
    if (!full.startsWith(PUBLIC + path.sep) || !existsSync(full) || !statSync(full).isFile()) return send(res, 404, 'text/plain', 'Not found');
    res.setHeader('Cache-Control', 'no-cache');
    send(res, 200, TYPES[path.extname(full)] || 'application/octet-stream', readFileSync(full));
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') return socket.destroy();
    const role = url.searchParams.get('role') === 'control' ? 'control' : 'overlay';
    if (role === 'control' && !keyOk(url)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    req.role = role;
    ws.handleUpgrade(req, socket, head);
  });

  ws.on('connection', (client, req) => {
    const id = crypto.randomUUID();
    const set = req.role === 'control' ? controls : overlays;
    set.add(client);
    client.on('close', () => {
      set.delete(client);
      overlayAudio.delete(id);
      scheduleState();
    });
    sendState(client);
    if (set === controls) client.send(JSON.stringify({ t: 'logs', entries: activity }));
    scheduleState();
    client.on('message', (raw, binary) => {
      if (binary) return;
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (set === overlays) {
        if (msg.t === 'audio') {
          overlayAudio.set(id, String(msg.state).slice(0, 20));
          scheduleState();
        }
        return; // overlays cannot control anything
      }
      let result = { ok: false, error: 'unknown' };
      if (msg.t === 'action' && actions[msg.name]) result = actions[msg.name](msg.args || {});
      else if (msg.t === 'settings') result = { ok: true, changed: applySettings(msg.patch) };
      client.send(JSON.stringify({ t: 'result', id: msg.id ?? null, name: msg.name ?? msg.t, ...result }));
      flushState();
    });
  });

  const tick = setInterval(() => game.tick(), 200);
  tick.unref?.();
  const heartbeat = setInterval(scheduleState, 1000);
  heartbeat.unref?.();

  return {
    server,
    game,
    scores,
    settings: settingsStore,
    sim,
    live,
    health,
    elog,
    actions,
    applySettings,
    async close() {
      clearInterval(tick);
      clearInterval(heartbeat);
      health.stop();
      elog.close();
      clearTimeout(stateTimer);
      clearTimeout(likeTimer);
      await sim.stop();
      await live.stop();
      ws.close();
      scores.saveNow();
      await new Promise((r) => server.close(() => r()));
    },
  };
}

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}

// ---------------------------------------------------------------------- main
async function main() {
  const config = loadConfig();
  let dict;
  let secrets;
  let tiers;
  try {
    const t0 = Date.now();
    if (!existsSync(config.kbbiCsv)) loadKbbi(config.kbbiCsv); // throws the helpful "put kbbi.csv in data/" error
    secrets = loadSecrets(config.secretWords);
    const easy = loadOptionalList(config.secretWordsEasy);
    const hard = loadOptionalList(config.secretWordsHard);
    tiers = buildTiers(secrets, { easy, hard });
    // meanings (for the round recap) are only kept for words that can be an answer
    dict = loadKbbi(config.kbbiCsv, { meaningFor: new Set([...secrets, ...(easy ?? []), ...(hard ?? [])]) });
    console.log(`[kbbi] ${dict.size.toLocaleString()} words from ${dict.rows.toLocaleString()} rows (${Date.now() - t0} ms)`);
  } catch (err) {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
  const missing = secrets.filter((w) => !dict.has(w));
  if (missing.length) console.warn(`[secrets] ${missing.length} secret words are not in the KBBI list (still playable), e.g. ${missing.slice(0, 5).join(', ')}`);
  console.log(`[secrets] ${secrets.length.toLocaleString()} secret words (easy ${tiers.easy.length.toLocaleString()}, normal ${tiers.normal.length.toLocaleString()}, hard ${tiers.hard.length.toLocaleString()})`);

  let vectors = null;
  if (config.vectorsPath) {
    try {
      vectors = await loadVectors(config.vectorsPath, { vocab: dict.words, maxLines: config.vectorsMaxLines, log: console.log });
    } catch (err) {
      console.error(`[vectors] ${err.message}. Every guess will be out of range until this is fixed.`);
    }
  } else console.log('[vectors] VECTORS_PATH not set: every guess will be out of range (no ranking)');

  const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
  if (!config.controlKey && !isLoopback) {
    config.controlKey = crypto.randomBytes(9).toString('base64url');
    console.log(`[control] HOST is ${config.host}, so the control page needs a key. Generated one for this run (set CONTROL_KEY to keep it).`);
  }

  const app = createApp({ config, dict, secrets, tiers, vectors });
  app.server.listen(config.port, config.host, async () => {
    const base = `http://${isLoopback ? 'localhost' : config.host}:${config.port}`;
    const key = config.controlKey ? `?key=${encodeURIComponent(config.controlKey)}` : '';
    console.log('');
    console.log(`  Overlay (OBS, 1920x1080):  ${base}/`);
    console.log(`  Overlay portrait (1080x1920): ${base}/?layout=portrait`);
    console.log(`  Control page (NOT in OBS): ${base}/control${key}`);
    console.log('');
    let liveOk = false;
    if (!config.sim) liveOk = await app.live.start();
    if (!liveOk) {
      await app.sim.start();
      console.log(config.sim ? '[sim] simulator running' : '[sim] no LIVE connection, so the simulator is running. Turn it off on the control page.');
    }
    if (config.autoStart || !liveOk) app.game.startRound();
  });

  const shutdown = async () => {
    console.log('\nSaving scores...');
    await app.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
