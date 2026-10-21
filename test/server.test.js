import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';
import { loadKbbi } from '../src/kbbi.js';
import { loadSecrets } from '../src/secrets.js';
import { ChatSource } from '../src/live/source.js';
import { chatText, giftFrom, likeCount, StreamchimeSource, userFrom } from '../src/live/streamchime.js';
import { SimSource } from '../src/live/sim.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const dict = loadKbbi(path.join(FIX, 'kbbi_sample.csv'));
const secrets = loadSecrets(path.join(FIX, 'secret_words.txt'));

class FakeLive extends ChatSource {
  constructor() {
    super('fake');
    this.isLive = false;
  }
  get live() {
    return this.isLive;
  }
}

async function boot({ controlKey = '' } = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ctx-'));
  const live = new FakeLive();
  const app = createApp({ config: { dataDir, controlKey, hintGift: 'Rose', simIntensity: 1 }, dict, secrets, log: () => {}, liveSource: live });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  const open = (role, key = '') =>
    new Promise((resolve, reject) => {
      const sock = new WebSocket(`ws://127.0.0.1:${port}/ws?role=${role}${key ? `&key=${key}` : ''}`);
      const msgs = [];
      sock.onmessage = (e) => msgs.push(JSON.parse(e.data));
      sock.onopen = () => resolve({ sock, msgs, send: (m) => sock.send(JSON.stringify(m)) });
      sock.onerror = () => reject(new Error('ws failed'));
    });
  const close = async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  };
  return { app, port, open, live, close, base: `http://127.0.0.1:${port}` };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('overlay clients never receive the secret word; control clients do', async () => {
  const s = await boot();
  try {
    const overlay = await s.open('overlay');
    const control = await s.open('control');
    s.app.game.startRound();
    const secret = s.app.game.round.secret;
    s.live.onChat({ id: 'v1', name: 'viewer' }, 'rumah' === secret ? 'lampu' : 'rumah');
    await wait(200);
    const overlayText = JSON.stringify(overlay.msgs);
    assert.ok(overlay.msgs.some((m) => m.t === 'state' && m.state.round));
    assert.ok(!new RegExp(`"${secret}"`).test(overlayText), 'secret leaked to the overlay');
    const last = control.msgs.filter((m) => m.t === 'state').at(-1);
    assert.equal(last.state.secret, secret);
    overlay.sock.close();
    control.sock.close();
  } finally {
    await s.close();
  }
});

test('overlay messages cannot run control actions', async () => {
  const s = await boot();
  try {
    const overlay = await s.open('overlay');
    overlay.send({ t: 'action', name: 'start' });
    await wait(150);
    assert.equal(s.app.game.phase, 'idle');
    overlay.sock.close();
  } finally {
    await s.close();
  }
});

test('control actions: start, skip, reveal, settings, sim toggle blocked while LIVE', async () => {
  const s = await boot();
  try {
    const c = await s.open('control');
    c.send({ t: 'action', name: 'start' });
    await wait(120);
    assert.equal(s.app.game.phase, 'playing');
    c.send({ t: 'action', name: 'skip' });
    await wait(120);
    assert.equal(s.app.game.round.no, 2);
    c.send({ t: 'action', name: 'reveal' });
    await wait(120);
    assert.equal(s.app.game.phase, 'break');
    c.send({ t: 'settings', patch: { hintGift: 'Donut', cooldownMs: 5000, lang: 'en', bogus: 1 } });
    await wait(120);
    assert.equal(s.app.game.hintGift, 'Donut');
    assert.equal(s.app.game.cooldownMs, 5000);
    assert.equal(s.app.settings.values.bogus, undefined);
    s.live.isLive = true;
    c.send({ t: 'action', name: 'sim', args: { on: true } });
    await wait(120);
    assert.equal(s.app.sim.running, false, 'simulator never runs while LIVE is on');
    assert.ok(c.msgs.some((m) => m.t === 'result' && m.error === 'live'));
    c.send({ t: 'action', name: 'resetAllTime', args: {} });
    await wait(120);
    assert.ok(c.msgs.some((m) => m.t === 'result' && m.name === 'resetAllTime' && m.error === 'confirm'), 'needs the confirmation step');
    c.sock.close();
  } finally {
    await s.close();
  }
});

test('CSV export of the all-time board, and the control key', async () => {
  const s = await boot({ controlKey: 'secret123' });
  try {
    s.app.game.startRound();
    s.live.onChat({ id: 'v1', name: 'Real "Viewer", Jr' }, s.app.game.round.secret);
    let res = await fetch(`${s.base}/api/alltime.csv`);
    assert.equal(res.status, 403);
    res = await fetch(`${s.base}/api/alltime.csv?key=secret123`);
    assert.equal(res.status, 200);
    const csv = await res.text();
    assert.match(csv, /rank,id,name,points,wins/);
    assert.match(csv, /1,v1,"Real ""Viewer"", Jr",150,1/);
    assert.equal((await fetch(`${s.base}/control`)).status, 403);
    assert.equal((await fetch(`${s.base}/control?key=secret123`)).status, 200);
    await assert.rejects(s.open('control'));
  } finally {
    await s.close();
  }
});

test('static files are served and paths cannot escape public/', async () => {
  const s = await boot();
  try {
    assert.equal((await fetch(`${s.base}/`)).status, 200);
    assert.equal((await fetch(`${s.base}/js/shared/popup-queue.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal((await fetch(`${s.base}/..%2Fpackage.json`)).status, 404);
    assert.equal((await fetch(`${s.base}/%2e%2e/src/server.js`)).status, 404);
  } finally {
    await s.close();
  }
});

test('Streamchime event mapping', () => {
  const e = { type: 'chat', actor: { id: 123, handle: 'nadia.kw', display_name: 'Nadia', avatar_url: 'https://x/a.jpg' }, payload: { text: '!rumah' } };
  assert.deepEqual(userFrom(e), { id: '123', name: 'nadia.kw', nick: 'Nadia', avatar: 'https://x/a.jpg' });
  assert.equal(chatText(e), '!rumah');
  assert.deepEqual(giftFrom({ payload: { gift_name: 'Rose', repeat_count: 3 } }), { name: 'Rose', count: 3 });
  assert.deepEqual(giftFrom({ payload: { gift: { name: 'Rose' } } }), { name: 'Rose', count: 1 });
  assert.equal(likeCount({ payload: { count: 15 } }), 15);
  assert.equal(userFrom({ actor: { unique_id: 'budi' } }).id, 'budi');
  assert.equal(userFrom({}), null);
});

test('Streamchime without a key logs a clear message and stays off', async () => {
  const lines = [];
  const src = new StreamchimeSource({ appKey: '', username: 'me', log: (l) => lines.push(l) });
  assert.equal(await src.start(), false);
  assert.equal(src.live, false);
  assert.match(lines.join('\n'), /STREAMCHIME_APP_KEY is not set[\s\S]*simulator/);
});

test('ChatSource normalises users and drops events without one', () => {
  const src = new ChatSource('x');
  const got = [];
  src.on('chat', (u, t) => got.push([u, t]));
  src.on('gift', (u, g, n) => got.push([u.name, g, n]));
  src.onChat({ id: 1, name: '@budi', avatar: 'javascript:alert(1)' }, 'rumah');
  src.onChat(null, 'rumah');
  src.onGift({ id: 2, name: 'x' }, 'Rose', 0);
  assert.deepEqual(got, [
    [{ id: '1', name: 'budi', nick: null, avatar: null, sim: false }, 'rumah'],
    ['x', 'Rose', 1],
  ]);
});

test('simulator: SIM viewers guess, join, follow, like and gift', () => {
  const s = { started: false };
  const game = { phase: 'playing', hintGift: 'Rose', round: { secret: 'rumah', startedAt: 0, mode: 'letters' } };
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sim = new SimSource({ game, words: [...dict.words].filter((w) => /^[a-z]+$/.test(w)), rng, intensity: 3 });
  const kinds = new Set();
  let wins = 0;
  for (const k of ['chat', 'join', 'follow', 'like', 'gift']) sim.on(k, (u, text) => {
    kinds.add(k);
    assert.equal(u?.sim ?? true, true);
    if (k === 'chat' && text.replace('!', '').toLowerCase() === 'rumah') wins++;
  });
  for (let i = 0; i < 3000; i++) sim.step(i * 350);
  assert.deepEqual([...kinds].sort(), ['chat', 'follow', 'gift', 'join', 'like']);
  assert.ok(wins > 0, 'the simulator eventually finds the answer');
  assert.equal(s.started, false);
});
