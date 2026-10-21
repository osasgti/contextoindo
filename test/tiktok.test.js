// The TikTok adapter (piratetok-live-js): message shapes, gift streaks, duplicates, the events the
// game hears, and the off switch. The library is replaced by a fake client, so no test uses the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatText, giftFrom, likeCount, msgIdOf, TikTokSource, userFrom } from '../src/live/tiktok.js';

/** A stand-in for piratetok-live-js: the same class and event names, with connect() scripted by the test. */
async function fakeLib(connect = async () => '1') {
  const { EventType } = await import('piratetok-live-js');
  const made = [];
  class HostNotOnlineError extends Error {}
  class FakeClient {
    constructor(username) {
      this.username = username;
      this.handlers = {};
      made.push(this);
    }
    staleTimeout() {
      return this;
    }
    maxRetries() {
      return this;
    }
    on(event, fn) {
      this.handlers[event] = fn;
      return this;
    }
    connect() {
      return connect();
    }
    disconnect() {}
  }
  return { lib: { TikTokLiveClient: FakeClient, EventType, HostNotOnlineError }, made, HostNotOnlineError };
}

test('the installed library exports what the adapter uses', async () => {
  const lib = await import('piratetok-live-js');
  assert.equal(typeof lib.TikTokLiveClient, 'function');
  assert.equal(lib.EventType.chat, 'chat');
  assert.equal(lib.EventType.liveEnded, 'liveEnded');
  assert.equal(typeof lib.HostNotOnlineError, 'function');
});

test('user, chat and like fields follow the piratetok-live-js message shapes', () => {
  const chat = {
    common: { msgId: '55' },
    user: { id: 123, uniqueId: 'nadia.kw', nickname: 'Nadia', avatarThumb: { urlList: ['https://x/a.jpg'] } },
    content: '!rumah',
  };
  assert.deepEqual(userFrom(chat), { id: '123', name: 'nadia.kw', nick: 'Nadia', avatar: 'https://x/a.jpg' });
  assert.equal(chatText(chat), '!rumah');
  assert.equal(msgIdOf(chat), '55');
  assert.equal(likeCount({ count: 15 }), 15);
  assert.equal(likeCount({}), 1);
  assert.equal(userFrom({ user: { uniqueId: 'budi' } }).id, 'budi', 'no numeric id: the handle is used');
  assert.equal(userFrom({}), null);
});

test('gifts: a streak counts once, at its final event, with the full total', () => {
  const rose = { gift: { name: 'Rose', type: 1 }, repeatCount: 3, repeatEnd: 0 };
  assert.equal(giftFrom(rose), null, 'the streak is still running');
  assert.deepEqual(giftFrom({ ...rose, repeatCount: 5, repeatEnd: 1 }), { name: 'Rose', count: 5 });
  assert.deepEqual(giftFrom({ gift: { name: 'Heart Me', type: 0 }, repeatCount: 1 }), { name: 'Heart Me', count: 1 });
  assert.deepEqual(giftFrom({ gift: { name: 'Rose', type: '1' }, repeatCount: '2', repeatEnd: '1' }), { name: 'Rose', count: 2 });
});

test('a message with the same msgId is handled once', () => {
  const src = new TikTokSource({ username: 'me', log: () => {} });
  assert.equal(src._dup({ common: { msgId: '9' } }), false);
  assert.equal(src._dup({ common: { msgId: '9' } }), true);
  assert.equal(src._dup({}), false, 'no msgId: never treated as a repeat');
});

test('the @ is dropped from the username', () => {
  assert.equal(new TikTokSource({ username: '@mabar_live' }).username, 'mabar_live');
});

test('TikTok without a username logs a clear message and stays off', async () => {
  const lines = [];
  const src = new TikTokSource({ username: '', log: (l) => lines.push(l) });
  assert.equal(await src.start(), false);
  assert.equal(src.live, false);
  assert.equal(src.status, 'no-username');
  assert.match(lines.join('\n'), /TIKTOK_USERNAME is not set[\s\S]*simulator/);
});

test('events from the library reach the game as ChatSource events', async () => {
  const { lib, made } = await fakeLib();
  const src = new TikTokSource({ username: 'mabar_live', log: () => {} });
  src.lib = lib;
  const got = [];
  src.on('chat', (u, t) => got.push(['chat', u.name, t]));
  src.on('like', (u, n) => got.push(['like', u.name, n]));
  src.on('gift', (u, g, n) => got.push(['gift', u.name, g, n]));
  src.on('follow', (u) => got.push(['follow', u.name]));
  src.on('join', (u) => got.push(['join', u.name]));

  assert.equal(await src._connect(), true);
  assert.equal(src.live, true);
  assert.equal(src.status, 'live');
  assert.equal(made[0].username, 'mabar_live');

  const h = made[0].handlers;
  const chat = { common: { msgId: '1' }, user: { id: 1, uniqueId: 'budi' }, content: 'rumah' };
  h[lib.EventType.chat](chat);
  h[lib.EventType.chat](chat); // the same message again
  h[lib.EventType.gift]({ user: { id: 2, uniqueId: 'nadia' }, gift: { name: 'Rose', type: 1 }, repeatCount: 2, repeatEnd: 0 });
  h[lib.EventType.gift]({ user: { id: 2, uniqueId: 'nadia' }, gift: { name: 'Rose', type: 1 }, repeatCount: 3, repeatEnd: 1 });
  h[lib.EventType.like]({ user: { id: 3, uniqueId: 'ayu' }, count: 4 });
  h[lib.EventType.follow]({ user: { id: 4, uniqueId: 'dimas' } });
  h[lib.EventType.join]({ user: { id: 5, uniqueId: 'rina' } });

  assert.deepEqual(got, [
    ['chat', 'budi', 'rumah'],
    ['gift', 'nadia', 'Rose', 3],
    ['like', 'ayu', 4],
    ['follow', 'dimas'],
    ['join', 'rina'],
  ]);
  await src.stop();
});

test('a host who is not live yet stays offline and is checked again', async () => {
  const { lib, HostNotOnlineError } = await fakeLib(async () => {
    throw new HostNotOnlineError('not live');
  });
  const src = new TikTokSource({ username: 'mabar_live', log: () => {} });
  src.lib = lib;
  assert.equal(await src._connect(), false);
  assert.equal(src.live, false);
  assert.equal(src.status, 'offline');
  assert.ok(src.timer, 'a new try is scheduled');
  await src.stop();
  assert.equal(src.status, 'off');
  assert.equal(src.client, null);
});
