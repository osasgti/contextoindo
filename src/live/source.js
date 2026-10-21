// ChatSource: the one interface between a live platform and the game.
//
// An adapter (Streamchime, the simulator) extends ChatSource and calls
//   onChat(user, text)   onJoin(user)   onFollow(user)   onLike(user, count)   onGift(user, giftName, count)
// whenever something happens. The server listens with source.on('chat' | 'join' | ...).
// A user is { id, name, nick?, avatar?, sim? }: id is stable, name is the @handle.
import { EventEmitter } from 'node:events';

export function normalizeUser(u) {
  if (!u) return null;
  const id = String(u.id ?? u.name ?? '').trim();
  if (!id) return null;
  return {
    id,
    name: String(u.name || id).replace(/^@/, '').slice(0, 40),
    nick: u.nick ? String(u.nick).slice(0, 40) : null,
    avatar: typeof u.avatar === 'string' && /^https?:\/\//.test(u.avatar) ? u.avatar : null,
    sim: !!u.sim,
  };
}

export class ChatSource extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.reconnects = 0; // how many times the connection dropped and came back (health panel)
  }

  /** true while connected to a real LIVE room. The simulator is never live. */
  get live() {
    return false;
  }

  async start() {}

  async stop() {}

  /** Private reply to one viewer. Most platforms cannot send these; returns false then. */
  reply() {
    return false;
  }

  onChat(user, text) {
    const u = normalizeUser(user);
    if (u) this.emit('chat', u, String(text ?? ''));
  }

  onJoin(user) {
    const u = normalizeUser(user);
    if (u) this.emit('join', u);
  }

  onFollow(user) {
    const u = normalizeUser(user);
    if (u) this.emit('follow', u);
  }

  onLike(user, count = 1) {
    this.emit('like', normalizeUser(user), Math.max(1, Number(count) || 1));
  }

  onGift(user, giftName, count = 1) {
    const u = normalizeUser(user);
    if (u) this.emit('gift', u, String(giftName ?? ''), Math.max(1, Number(count) || 1));
  }
}
