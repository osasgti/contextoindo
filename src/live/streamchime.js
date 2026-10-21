// The only TikTok-specific file: Streamchime gateway -> ChatSource.
//
// Needs STREAMCHIME_APP_KEY (free Hobby key at streamchime.com/app/developers) and
// TIKTOK_USERNAME. Package: @streamchime/tiktok-live-sdk (installed by npm install).
// Set DEBUG_LIVE=1 to print every raw event, handy for checking field names.
import { ChatSource } from './source.js';

const pick = (obj, ...keys) => {
  for (const k of keys) {
    const v = k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), obj);
    if (v != null && v !== '') return v;
  }
  return undefined;
};

/** Event envelope -> { id, name, nick, avatar }. Accepts the actor or user shapes we have seen. */
export function userFrom(event) {
  const a = event?.actor || event?.payload?.user || event?.user || {};
  const name = pick(a, 'handle', 'unique_id', 'uniqueId', 'username', 'login');
  const id = pick(a, 'id', 'user_id', 'userId', 'platform_id') ?? name;
  if (id == null) return null;
  return {
    id: String(id),
    name: String(name ?? pick(a, 'display_name', 'nickname') ?? id),
    nick: pick(a, 'display_name', 'nickname', 'name') ?? null,
    avatar: pick(a, 'avatar_url', 'avatar', 'profile_picture_url', 'profilePictureUrl', 'picture') ?? null,
  };
}

export function chatText(event) {
  return String(pick(event?.payload, 'text', 'comment', 'message', 'content') ?? '');
}

export function giftFrom(event) {
  const p = event?.payload || {};
  return {
    name: String(pick(p, 'gift_name', 'giftName', 'gift.name', 'name') ?? ''),
    count: Number(pick(p, 'repeat_count', 'repeatCount', 'count', 'quantity', 'amount') ?? 1) || 1,
  };
}

export function likeCount(event) {
  return Number(pick(event?.payload, 'count', 'like_count', 'likeCount', 'likes') ?? 1) || 1;
}

export class StreamchimeSource extends ChatSource {
  constructor({ appKey, username, log = console.log, debug = false }) {
    super('streamchime');
    this.appKey = appKey;
    this.username = String(username || '').replace(/^@/, '').trim();
    this.log = log;
    this.debug = debug;
    this.connected = false;
    this.status = 'off';
    this.client = null;
    this.room = null;
  }

  get live() {
    return this.connected;
  }

  /** Resolves true when connected. Never throws: a failure leaves the simulator in charge. */
  async start() {
    if (!this.appKey) {
      this.status = 'no-key';
      this.log('[live] STREAMCHIME_APP_KEY is not set, so TikTok LIVE is off. The simulator keeps running.');
      this.log('[live] Get a free key at https://streamchime.com/app/developers and put it in .env');
      return false;
    }
    if (!this.username) {
      this.status = 'no-username';
      this.log('[live] TIKTOK_USERNAME is not set, so there is no room to join. The simulator keeps running.');
      return false;
    }
    let sdk;
    try {
      sdk = await import('@streamchime/tiktok-live-sdk');
    } catch {
      this.status = 'no-sdk';
      this.log('[live] The Streamchime SDK is not installed. Run: npm install @streamchime/tiktok-live-sdk');
      return false;
    }
    try {
      const Client = sdk.StreamchimeClient || sdk.default?.StreamchimeClient;
      this.client = new Client({ apiKey: this.appKey });
      this.client.on?.('error', (err) => {
        this.connected = false;
        this.status = 'error';
        this.log(`[live] Streamchime error: ${err?.message || err}`);
        this.emit('status', this.status);
      });
      this.client.on?.('disconnect', (code) => {
        this.connected = false;
        this.status = 'reconnecting';
        this.reconnects++;
        this.log(`[live] Streamchime disconnected (${code}); it reconnects by itself`);
        this.emit('status', this.status);
      });
      this.client.on?.('ready', () => {
        if (this.room) {
          this.connected = true;
          this.status = 'live';
          this.emit('status', this.status);
        }
      });
      this.room = this.client.room(this.username);
      const dbg = (type) => (e) => this.debug && this.log(`[live:${type}]`, JSON.stringify(e).slice(0, 600));
      this.room.on('chat', (e) => {
        dbg('chat')(e);
        this.onChat(userFrom(e), chatText(e));
      });
      this.room.on('gift', (e) => {
        dbg('gift')(e);
        const g = giftFrom(e);
        this.onGift(userFrom(e), g.name, g.count);
      });
      this.room.on('like', (e) => {
        dbg('like')(e);
        this.onLike(userFrom(e), likeCount(e));
      });
      this.room.on('follow', (e) => {
        dbg('follow')(e);
        this.onFollow(userFrom(e));
      });
      this.room.on('join', (e) => {
        dbg('join')(e);
        this.onJoin(userFrom(e));
      });
      this.room.on('streamEnd', () => this.log('[live] the LIVE has ended'));
      await this.room.connect();
      this.connected = true;
      this.status = 'live';
      this.log(`[live] connected to @${this.username} through Streamchime`);
      this.emit('status', this.status);
      return true;
    } catch (err) {
      this.connected = false;
      this.status = 'error';
      this.log(`[live] could not connect to @${this.username}: ${err?.title || err?.message || err}`);
      this.emit('status', this.status);
      return false;
    }
  }

  async stop() {
    this.connected = false;
    this.status = 'off';
    try {
      await this.room?.disconnect?.();
      await this.client?.close?.();
    } catch {
      /* closing anyway */
    }
  }
}
