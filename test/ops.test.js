// Stream operations: rotating event log, health numbers, panic, and the leak guarantee.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RotatingLog } from '../src/eventlog.js';
import { HealthMonitor } from '../src/health.js';
import { createApp } from '../src/server.js';
import { loadKbbi } from '../src/kbbi.js';
import { loadSecrets } from '../src/secrets.js';
import { ChatSource } from '../src/live/source.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'wi-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ event log
test('event log writes one JSON line per event', () => {
  const dir = tmp();
  try {
    const log = new RotatingLog(dir, { now: () => Date.parse('2026-10-21T01:02:03Z') });
    log.write('chat', { user: 'a', text: 'rumah' });
    log.write('evt', { evt: { type: 'win' } });
    log.close();
    const lines = readFileSync(path.join(dir, 'events.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0], { t: '2026-10-21T01:02:03.000Z', kind: 'chat', user: 'a', text: 'rumah' });
    assert.equal(lines[1].evt.type, 'win');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('event log rotates by size and keeps only the newest files', () => {
  const dir = tmp();
  try {
    const log = new RotatingLog(dir, { maxBytes: 300, keep: 3 });
    for (let i = 0; i < 40; i++) {
      log.write('n', { i, pad: 'x'.repeat(40) });
      log.flush();
    }
    const files = readdirSync(dir).sort();
    assert.deepEqual(files, ['events.log', 'events.log.1', 'events.log.2', 'events.log.3']);
    // the newest line is in the live file, and nothing older than keep+1 files survives
    const live = readFileSync(path.join(dir, 'events.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(live.at(-1).i, 39);
    for (const f of files) assert.ok(readFileSync(path.join(dir, f)).length <= 300 + 120, `${f} stays near the limit`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a broken log never throws into the game', () => {
  const dir = tmp();
  try {
    const blocker = path.join(dir, 'logs');
    writeFileSync(blocker, 'a file where the folder should be');
    const errors = [];
    const log = new RotatingLog(blocker, { onError: (e) => errors.push(e) });
    log.write('x');
    assert.doesNotThrow(() => log.flush());
    assert.equal(errors.length, 1);
    assert.equal(log.enabled, false);
    assert.doesNotThrow(() => log.write('y'));
    assert.equal(new RotatingLog(null).enabled, false, 'no folder, no log');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ health
test('health counts events in the last minute and reports the process numbers', () => {
  const clock = { t: 1_000_000 };
  const h = new HealthMonitor({ now: () => clock.t });
  assert.equal(h.snapshot().lastEventAt, null);
  h.noteEvent();
  clock.t += 30_000;
  h.noteEvent();
  h.noteEvent();
  let s = h.snapshot();
  assert.equal(s.eventsPerMin, 3);
  assert.equal(s.lastEventAt, clock.t);
  clock.t += 45_000; // the first one is now older than a minute
  s = h.snapshot();
  assert.equal(s.eventsPerMin, 2);
  assert.equal(s.uptimeS, 75);
  assert.ok(s.rssMb > 0 && s.heapMb > 0);
  h.start();
  h.sample();
  assert.ok(Number.isFinite(h.snapshot().cpuPct) && Number.isFinite(h.snapshot().loopLagMs));
  h.stop();
});

// ------------------------------------------------------------------ server
class FakeLive extends ChatSource {
  constructor() {
    super('fake');
    this.reconnects = 2;
  }
}

async function boot() {
  const dataDir = tmp();
  const dict = loadKbbi(path.join(FIX, 'kbbi_sample.csv'));
  const secrets = loadSecrets(path.join(FIX, 'secret_words.txt'));
  const live = new FakeLive();
  const app = createApp({ config: { dataDir, controlKey: '', hintGift: 'Rose', simIntensity: 1, tiktokUsername: 'osas' }, dict, secrets, log: () => {}, liveSource: live });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  const open = (role) =>
    new Promise((resolve, reject) => {
      const sock = new WebSocket(`ws://127.0.0.1:${port}/ws?role=${role}`);
      const msgs = [];
      sock.onmessage = (e) => msgs.push(JSON.parse(e.data));
      sock.onopen = () => resolve({ sock, msgs, send: (m) => sock.send(JSON.stringify(m)) });
      sock.onerror = () => reject(new Error('ws failed'));
    });
  return {
    app,
    live,
    open,
    dataDir,
    async close() {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

const lastState = (c) => c.msgs.filter((m) => m.t === 'state').at(-1);

test('panic hides the round on the overlay and the control page, and resuming restores it', async () => {
  const s = await boot();
  try {
    const overlay = await s.open('overlay');
    const control = await s.open('control');
    s.app.game.startRound();
    const secret = s.app.game.round.secret;
    await wait(150);
    assert.equal(lastState(control).state.secret, secret);
    assert.ok(lastState(overlay).state.round);

    control.send({ t: 'action', name: 'panic', id: 1 });
    await wait(200);
    assert.equal(lastState(overlay).state.panic, true);
    assert.equal(lastState(overlay).state.round, null, 'the overlay gets no round while panicking');
    assert.equal(lastState(control).state.secret, null, 'the control page hides the answer too');
    const result = control.msgs.find((m) => m.t === 'result' && m.id === 1);
    assert.equal(result.ok, true);
    assert.equal(result.panic, true);

    s.live.onChat({ id: 'v', name: 'viewer' }, secret);
    await wait(100);
    assert.equal(s.app.game.phase, 'playing', 'a correct guess during panic does not win');

    control.send({ t: 'action', name: 'skip', id: 2 });
    await wait(100);
    assert.equal(control.msgs.find((m) => m.t === 'result' && m.id === 2).error, 'panic', 'no round control while panicking');

    control.send({ t: 'action', name: 'panic', id: 3 });
    await wait(200);
    assert.equal(lastState(overlay).state.panic, false);
    assert.ok(lastState(overlay).state.round);
    assert.equal(lastState(control).state.secret, secret);
    overlay.sock.close();
    control.sock.close();
  } finally {
    await s.close();
  }
});

test('commands and the free hint never put the secret on the overlay', async () => {
  const s = await boot();
  try {
    const overlay = await s.open('overlay');
    s.app.game.startRound();
    const secret = s.app.game.round.secret;
    s.app.game.round.startedAt -= 120000; // past the 1-minute mark for !hint
    for (const [i, c] of ['!top', '!ronde', '!streak', '!hint'].entries()) s.live.onChat({ id: `u${i}`, name: `u${i}` }, c);
    await wait(250);
    const evts = overlay.msgs.filter((m) => m.t === 'evt').map((m) => m.evt);
    assert.ok(evts.some((e) => e.type === 'cmd' && e.cmd === 'top'));
    assert.ok(evts.some((e) => e.type === 'hint' && e.kind === 'free'));
    assert.ok(!new RegExp(`"${secret}"`).test(JSON.stringify(overlay.msgs)), 'the secret leaked to the overlay');
    overlay.sock.close();
  } finally {
    await s.close();
  }
});

test('the control page gets health numbers, and the event log is written under data/logs', async () => {
  const s = await boot();
  try {
    const control = await s.open('control');
    s.app.game.startRound();
    s.live.onChat({ id: 'a', name: 'a' }, 'rumah');
    s.live.onGift({ id: 'g', name: 'g' }, 'Galaxy', 3);
    await wait(250);
    const h = lastState(control).status.health;
    assert.equal(h.reconnects, 2);
    assert.ok(h.eventsPerMin >= 2);
    assert.ok(h.lastEventAt > 0 && h.rssMb > 0);
    assert.equal(h.logging, true);
    s.app.elog.flush();
    const text = readFileSync(path.join(s.dataDir, 'logs', 'events.log'), 'utf8');
    assert.match(text, /"kind":"chat"/);
    assert.match(text, /"kind":"evt"/);
    assert.match(text, /Galaxy/);
    control.sock.close();
  } finally {
    await s.close();
  }
  assert.ok(!existsSync(s.dataDir), 'cleaned up');
});

test('the streamer account is told apart from viewers', async () => {
  const s = await boot();
  try {
    s.app.game.startRound();
    const secret = s.app.game.round.secret;
    s.live.onChat({ id: '1', name: 'osas' }, secret);
    assert.equal(s.app.game.phase, 'playing', 'TIKTOK_USERNAME is the streamer: their win is ignored');
    s.live.onChat({ id: '2', name: 'viewer' }, secret);
    assert.equal(s.app.game.phase, 'break');
  } finally {
    await s.close();
  }
});
