// The only TikTok-specific file: piratetok-live-js -> ChatSource.
//
// Needs TIKTOK_USERNAME. No API key: the library connects the way the TikTok website does.
// Package: piratetok-live-js (installed by npm install). Set DEBUG_LIVE=1 to print every event as one line.
import { ChatSource } from './source.js';

// Quiet streams send no events for long stretches; the library default (60 s) would drop them.
const STALE_TIMEOUT_MS = 10 * 60 * 1000;
// The library gives up after MAX_RETRIES failed reconnects, so our own loop keeps trying after that.
const MAX_RETRIES = 60;
// TikTok rate-limits anonymous requests, so retries start slow and only reset after a stable session.
const RETRY_MIN_MS = 15000;
const RETRY_MAX_MS = 300000;
const STABLE_MS = 30000;
// The host is not live yet: check once a minute.
const OFFLINE_RETRY_MS = 60000;

const firstUrl = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return /^https?:\/\//.test(v) ? v : null;
  if (Array.isArray(v)) {
    for (const x of v) {
      const u = firstUrl(x);
      if (u) return u;
    }
    return null;
  }
  if (typeof v === 'object') {
    for (const k of ['url', 'urls', 'urlList', 'url_list', 'uri']) {
      const u = firstUrl(v[k]);
      if (u) return u;
    }
  }
  return null;
};

/** Event -> { id, name, nick, avatar } for ChatSource. name is the @handle; id is the stable TikTok id. */
export function userFrom(d) {
  const u = d?.user && typeof d.user === 'object' ? d.user : d || {};
  const handle = String(u.uniqueId ?? d?.uniqueId ?? '').trim();
  const rawId = u.userId ?? d?.userId ?? u.id ?? null;
  const id = rawId != null && String(rawId) !== '0' && String(rawId) !== '' ? String(rawId) : handle;
  if (!id) return null;
  return {
    id,
    name: handle || id,
    nick: String(u.nickname ?? d?.nickname ?? '').trim() || null,
    avatar: firstUrl(u.avatarThumb) || firstUrl(u.avatarMedium) || firstUrl(u.profilePictureUrl) || null,
  };
}

export function chatText(d) {
  return String(d?.content ?? d?.comment ?? '').trim();
}

/** Null while a streak is still running. Streakable gifts (type 1) send running totals until repeatEnd. */
export function giftFrom(d) {
  const gift = d?.gift || {};
  if (Number(gift.type ?? 0) === 1 && !Number(d?.repeatEnd ?? 0)) return null;
  const name = String(gift.name ?? d?.giftName ?? '').trim();
  const count = Math.max(1, Math.floor(Number(d?.repeatCount ?? 1)) || 1);
  return { name, count };
}

export function likeCount(d) {
  return Number(d?.count ?? d?.likeCount ?? 1) || 1;
}

export function msgIdOf(d) {
  const v = d?.common?.msgId ?? d?.msgId ?? null;
  return v != null && String(v) !== '0' ? String(v) : null;
}

export class TikTokSource extends ChatSource {
  constructor({ username, log = console.log, debug = false }) {
    super('tiktok');
    this.username = String(username || '').replace(/^@/, '').trim();
    this.log = log;
    this.debug = debug;
    this.connected = false;
    this.status = 'off';
    this.lib = null;
    this.client = null;
    this.timer = null;
    this.stableTimer = null;
    this.stopped = false;
    this.backoff = RETRY_MIN_MS;
    this.lostDelay = RETRY_MIN_MS;
    this.offlineLogged = false;
    this.seen = new Set();
    this.seenOrder = [];
  }

  get live() {
    return this.connected;
  }

  /** Resolves true when connected. Never throws: a failure leaves the simulator in charge, and the loop keeps trying. */
  async start() {
    if (!this.username) {
      this.status = 'no-username';
      this.log('[live] TIKTOK_USERNAME is not set, so there is no room to join. The simulator keeps running.');
      return false;
    }
    try {
      this.lib = await import('piratetok-live-js');
      if (!this.lib.TikTokLiveClient || !this.lib.EventType) throw new Error('unsupported piratetok-live-js version');
    } catch (err) {
      this.status = 'error';
      this.log(`[live] cannot load piratetok-live-js (${err.message}). Run: npm install`);
      return false;
    }
    return this._connect();
  }

  async stop() {
    this.stopped = true;
    this.connected = false;
    clearTimeout(this.timer);
    clearTimeout(this.stableTimer);
    this._closeClient();
    this.status = 'off';
  }

  _setStatus(status) {
    this.status = status;
    this.emit('status', status);
  }

  _closeClient() {
    const old = this.client;
    this.client = null;
    try {
      old?.disconnect?.();
    } catch {
      /* closing anyway */
    }
  }

  _retry(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this._connect();
    }, ms);
  }

  /** True when this message was already handled (TikTok can send the same message twice). */
  _dup(d) {
    const id = msgIdOf(d);
    if (!id) return false;
    if (this.seen.has(id)) return true;
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > 5000) this.seen.delete(this.seenOrder.shift());
    return false;
  }

  // One line per event, in the same style as the activity log: "[live:gift] Name sent Rose x3".
  _debug(type, d, verb) {
    if (!this.debug) return;
    const u = userFrom(d);
    this.log(`[live:${type}] ${u ? u.name : '?'} ${verb}`);
  }

  async _connect() {
    if (this.stopped) return false;
    clearTimeout(this.timer);
    clearTimeout(this.stableTimer);
    this._closeClient();
    this._setStatus('connecting');
    const { TikTokLiveClient, EventType } = this.lib;
    const client = new TikTokLiveClient(this.username).staleTimeout(STALE_TIMEOUT_MS).maxRetries(MAX_RETRIES);
    this.client = client;

    client.on(EventType.chat, (d) => {
      this._debug('chat', d, `says: ${chatText(d)}`);
      if (this._dup(d)) return;
      const text = chatText(d);
      if (text) this.onChat(userFrom(d), text);
    });
    client.on(EventType.gift, (d) => {
      this._debug('gift', d, `sent ${d?.gift?.name ?? d?.giftName ?? '?'}${Number(d?.repeatCount) > 1 ? ` x${d.repeatCount}` : ''}`);
      const g = giftFrom(d);
      if (!g || !g.name || this._dup(d)) return; // a streak still running, or a repeat
      this.onGift(userFrom(d), g.name, g.count);
    });
    client.on(EventType.like, (d) => {
      this._debug('like', d, `sent ${likeCount(d)} likes`);
      if (this._dup(d)) return;
      const u = userFrom(d);
      if (u) this.onLike(u, likeCount(d));
    });
    client.on(EventType.follow, (d) => {
      this._debug('follow', d, 'followed');
      if (this._dup(d)) return;
      const u = userFrom(d);
      if (u) this.onFollow(u);
    });
    client.on(EventType.join, (d) => {
      this._debug('join', d, 'joined');
      const u = userFrom(d);
      if (u) this.onJoin(u);
    });

    const lost = (why) => {
      if (this.client !== client || this.stopped) return;
      this.connected = false;
      clearTimeout(this.stableTimer);
      const delay = this.lostDelay;
      this.lostDelay = Math.min(delay * 2, RETRY_MAX_MS);
      this.reconnects++;
      this.log(`[live] ${why}, reconnecting in ${Math.round(delay / 1000)}s`);
      this._setStatus('reconnecting');
      this._retry(delay);
    };
    // the library reconnects by itself for a while; its own events keep the status right in between
    client.on(EventType.connected, () => {
      if (this.client !== client) return;
      this.connected = true;
      this._setStatus('live');
    });
    client.on(EventType.reconnecting, () => {
      if (this.client !== client) return;
      this.connected = false;
      this._setStatus('reconnecting');
    });
    client.on(EventType.disconnected, () => lost('the connection dropped'));
    client.on(EventType.liveEnded, () => lost('the LIVE has ended'));
    client.on('error', (err) => {
      if (this.client === client) this.log(`[live] TikTok error: ${err?.message || err}`);
    });

    try {
      await client.connect();
      if (this.client !== client || this.stopped) return false;
      this.connected = true;
      this.backoff = RETRY_MIN_MS;
      this.offlineLogged = false;
      this.log(`[live] connected to @${this.username} through piratetok-live-js`);
      this._setStatus('live');
      this.stableTimer = setTimeout(() => {
        this.lostDelay = RETRY_MIN_MS;
      }, STABLE_MS);
      return true;
    } catch (err) {
      if (this.client !== client || this.stopped) return false;
      this.connected = false;
      const NotLive = this.lib.HostNotOnlineError;
      if (NotLive && err instanceof NotLive) {
        if (!this.offlineLogged) this.log(`[live] @${this.username} is not live yet. Checking again every minute.`);
        this.offlineLogged = true;
        this._setStatus('offline');
        this._retry(OFFLINE_RETRY_MS);
        return false;
      }
      const msg = err?.message || String(err);
      this.log(`[live] could not connect to @${this.username}: ${msg}. Retrying in ${Math.round(this.backoff / 1000)}s`);
      this._setStatus('offline');
      this._retry(this.backoff);
      this.backoff = Math.min(this.backoff * 2, RETRY_MAX_MS);
      return false;
    }
  }
}
