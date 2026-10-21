import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FADE_MS, POPUP_DURATION, POPUP_PRIORITY, PopupQueue } from '../public/js/shared/popup-queue.js';

test('priority order matches the spec', () => {
  const order = ['winner', 'gift', 'hint', 'follow', 'join', 'instructions', 'helper', 'streak'];
  for (let i = 1; i < order.length; i++) assert.ok(POPUP_PRIORITY[order[i - 1]] < POPUP_PRIORITY[order[i]], order[i]);
});

test('most important queued popup shows first, FIFO within a priority', () => {
  const q = new PopupQueue();
  q.push('streak', {}, 0);
  q.push('join', { n: 1 }, 0);
  q.push('winner', {}, 0);
  q.push('join', { n: 2 }, 0);
  const seen = [];
  let t = 0;
  while (seen.length < 4) {
    const { current } = q.tick(t);
    if (current && seen[seen.length - 1] !== current) seen.push(current);
    t += 100;
  }
  assert.deepEqual(seen.map((p) => p.type + (p.data.n ?? '')), ['winner', 'join1', 'join2', 'streak']);
});

test('only one popup at a time; it shows, fades, then the next starts', () => {
  const q = new PopupQueue();
  q.push('follow', {}, 0);
  q.push('join', {}, 0);
  const d = POPUP_DURATION.follow;
  assert.equal(q.tick(0).current.type, 'follow');
  assert.equal(q.tick(0).phase, 'show');
  assert.equal(q.tick(d - 1).phase, 'show');
  assert.equal(q.tick(d).phase, 'out');
  assert.equal(q.tick(d + FADE_MS - 1).current.type, 'follow');
  const next = q.tick(d + FADE_MS);
  assert.equal(next.current.type, 'join');
  assert.equal(next.phase, 'show');
});

test('a more important popup waits; it never interrupts the current one', () => {
  const q = new PopupQueue();
  q.push('instructions', {}, 0);
  q.tick(0);
  q.push('winner', {}, 100);
  assert.equal(q.tick(200).current.type, 'instructions');
  assert.equal(q.tick(POPUP_DURATION.instructions + FADE_MS).current.type, 'winner');
});

test('stale low-priority popups are dropped, important ones are kept', () => {
  const q = new PopupQueue();
  q.push('winner', {}, 0);
  q.push('join', {}, 0);
  q.tick(0); // winner shows for 7 s
  q.push('gift', {}, 0);
  const t = 60000;
  assert.equal(q.tick(t).current.type, 'gift', 'gift has no max age');
  assert.equal(q.tick(t + POPUP_DURATION.gift + FADE_MS).current, null, 'the minute-old join card was dropped');
});

test('queue is bounded and drops the least important first', () => {
  const q = new PopupQueue({ maxQueued: 3 });
  q.push('streak', {}, 0);
  q.push('winner', {}, 0);
  q.push('join', {}, 0);
  q.push('gift', {}, 0);
  assert.equal(q.size, 3);
  assert.deepEqual(q.items.map((p) => p.type).sort(), ['gift', 'join', 'winner']);
  assert.throws(() => q.push('nope'), /unknown popup/);
});

test('drop() clears queued popups of one type', () => {
  const q = new PopupQueue();
  q.push('instructions', {}, 0);
  q.push('join', {}, 0);
  q.drop('instructions');
  assert.deepEqual(q.items.map((p) => p.type), ['join']);
});

test('the new cards slot in between the old priorities', () => {
  const P = POPUP_PRIORITY;
  assert.ok(P.hint < P.close && P.close < P.hot && P.hot < P.follow, 'near-miss and hot streak come after hints, before follows');
  assert.ok(P.follow < P.cmd && P.cmd < P.join, 'command answers come after follows, before join cards');
  assert.ok(P.streak < P.thanks, 'thank-yous are the least important');
  for (const type of Object.keys(P)) assert.ok(POPUP_DURATION[type] > 0, `${type} has a duration`);
});

test('hot-streak and thank-you cards that waited too long are dropped instead of shown late', () => {
  const q = new PopupQueue();
  q.push('winner', {}, 0);
  q.push('hot', {}, 0);
  q.push('cmd', {}, 0);
  q.push('thanks', {}, 0);
  q.push('close', {}, 0);
  assert.equal(q.tick(0).current.type, 'winner');
  // the winner card is long; by the time it is gone the hot card is older than 8 s
  const t = POPUP_DURATION.winner + FADE_MS;
  const seen = [];
  let now = t;
  while (now < t + 60000) {
    const { current } = q.tick(now);
    if (current && seen[seen.length - 1] !== current.type) seen.push(current.type);
    now += 100;
  }
  // hot (8 s) and thanks (10 s) waited too long behind the other cards and are dropped
  assert.deepEqual(seen, ['close', 'cmd']);
});
