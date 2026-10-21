// Simulator: fake viewers typing guesses, joining, following, liking and sending gifts.
// Every simulated user is marked sim: true, so nothing they score reaches the all-time board.
// It peeks at the secret only to make its guesses look like a real chat getting warmer.
import { ChatSource } from './source.js';

const NAMES = [
  'nadia.kw', 'budi_santoso', 'raka99', 'sitisaraa', 'dimas.art', 'putri.ayu', 'agus_pratama', 'rina.mlg',
  'fajar.id', 'dewi.lestari', 'bayu_77', 'intan.p', 'yoga.sby', 'nisa.rahma', 'eko.jkt', 'wulan_d',
  'rizky.f', 'maya.bdg', 'hendra.k', 'tari.solo', 'gilang_r', 'citra.mks', 'andi.plg', 'lina.dps',
  'joko_w88', 'mega.smg', 'reza.btm', 'salsa.kdr',
];
const NOISE = ['wkwkwk', 'halo kak', 'susah banget 😭', 'apa ya', 'semangat!!', 'kak itu apa', 'hmm', '🔥🔥', 'gg', 'dingin bgt'];
const TYPOS = ['rumahh', 'qwerty', 'lampuu', 'asdf', 'kucin', 'gedungg'];
const OTHER_GIFTS = ['TikTok', 'Galaxy', 'Donut', 'Finger Heart'];
const COMMANDS = ['!top', '!hint', '!ronde', '!streak'];

export class SimSource extends ChatSource {
  constructor({ game, words, rng = Math.random, viewers = 22, intensity = 1, stepMs = 350 }) {
    super('sim');
    this.game = game;
    this.words = words;
    this.rng = rng;
    this.intensity = Math.max(0.2, Number(intensity) || 1);
    this.stepMs = stepMs;
    this.users = NAMES.slice(0, Math.min(NAMES.length, viewers)).map((name, i) => ({ id: `sim-${i}`, name, sim: true }));
    this.timer = null;
  }

  get running() {
    return !!this.timer;
  }

  async start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), this.stepMs);
    this.timer.unref?.();
  }

  async stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  _user() {
    return this.users[Math.floor(this.rng() * this.users.length)];
  }

  _chance(p) {
    return this.rng() < p * this.intensity;
  }

  /** A guess that drifts warmer as the round goes on, and now and then the answer. */
  guessFor(round, now) {
    const elapsed = now - round.startedAt;
    const secret = round.secret;
    const winChance = elapsed < 45000 ? 0 : Math.min(0.05, (elapsed - 45000) / 2_400_000);
    if (this.rng() < winChance) return secret;
    const sample = Array.from({ length: 30 }, () => this.words[Math.floor(this.rng() * this.words.length)]).filter((w) => w !== secret);
    if (!sample.length) return secret;
    if (this.rng() < 0.4) {
      const score = (w) => -(round.ranker?.rankOf(w) ?? 1e9); // closer (lower rank) is better
      return sample.reduce((a, b) => (score(b) > score(a) ? b : a));
    }
    return sample[0];
  }

  step(now = Date.now()) {
    const g = this.game;
    const r = g.round;
    if (g.phase === 'playing' && r) {
      const n = 1 + (this.rng() < 0.5 * this.intensity ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const roll = this.rng();
        let text;
        if (roll < 0.08) text = NOISE[Math.floor(this.rng() * NOISE.length)];
        else if (roll < 0.12) text = TYPOS[Math.floor(this.rng() * TYPOS.length)];
        else {
          text = this.guessFor(r, now);
          if (this.rng() < 0.3) text = `!${text}`;
          if (this.rng() < 0.1) text = text.toUpperCase();
        }
        this.onChat(this._user(), text);
      }
      if (this._chance(0.012)) this.onGift(this._user(), g.hintGift, 1);
      if (this._chance(0.01)) this.onGift(this._user(), OTHER_GIFTS[Math.floor(this.rng() * OTHER_GIFTS.length)], 1);
    }
    if (this._chance(0.02)) this.onChat(this._user(), '!main');
    if (this._chance(0.012)) this.onChat(this._user(), COMMANDS[Math.floor(this.rng() * COMMANDS.length)]);
    if (this._chance(0.008)) this.onFollow(this._user());
    if (this._chance(0.14)) this.onLike(this._user(), 1 + Math.floor(this.rng() * 15));
    if (this._chance(0.05)) this.onJoin(this._user());
  }
}
