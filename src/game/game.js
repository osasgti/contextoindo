// The round state machine:  idle -> playing -> break -> playing -> ...
//
// Time is injected (`now`) and advanced with tick(), so tests can run a whole
// 6-minute round in microseconds. Everything the overlay needs is emitted as
// 'evt' events; the secret word only ever appears in controlState().
import { EventEmitter } from 'node:events';
import { buildTiers, pickSecret } from '../secrets.js';
import { parseCommand, parseGuess } from './guess.js';
import { closeness } from './closeness.js';
import { helperPoints, winPoints } from './points.js';

export const PHASE = { IDLE: 'idle', PLAYING: 'playing', BREAK: 'break' };

export const RULES = {
  breakMs: 15000,
  firstLetterMs: 180000,
  revealMs: 360000,
  giftHintsPerRound: 3,
  giftHintsPerViewer: 3, // one viewer may use every hint of a round; lower it to share them out
  boardSize: 60, // guesses sent to the overlay (best first)
  joinCardEveryMs: 60000,
  // chat commands
  freeHintAfterMs: 60000, // !hint opens one minute into the round
  commandUserMs: 20000, // one command card per viewer every 20 s ...
  commandGlobalMs: 6000, // ... and one per command for the whole chat every 6 s
  // hot streak: many guesses in a short window
  hotWindowMs: 10000,
  hotCount: 8,
  hotCooldownMs: 25000,
  hotHoldMs: 6000, // how long the overlay stays in its hot state
  // close call: first near-miss of a round
  closeRank: 3, // close call: rank 2 or 3
};

export const REPLY_NOT_IN_KBBI = { id: 'Kata tidak ada dalam KBBI.', en: 'That word is not in KBBI.' };

const norm = (s) => String(s ?? '').trim().toLowerCase();

export class Game extends EventEmitter {
  /**
   * @param {object} o
   * @param {{has(w:string):boolean, wordClass(w:string):string|null}} o.dict valid guesses (KBBI)
   * @param {string[]} o.secrets secret answers
   * @param {import('./vectors.js').VectorSpace|null} [o.vectors]
   * @param {object} [o.settings] live settings object (cooldownMs, hintGift, lang)
   * @param {object} [o.scores] all-time store with add(user, points, info)
   * @param {{easy:string[], normal:string[], hard:string[]}} [o.tiers] word pools per difficulty
   * @param {string} [o.streamer] the streamer's TikTok handle (their own winning guess is ignored)
   */
  constructor({ dict, secrets, vectors = null, settings = {}, scores = null, now = () => Date.now(), rng = Math.random, rules = {}, tiers = null, streamer = '' }) {
    super();
    this.dict = dict;
    this.secrets = secrets;
    this.tiers = tiers ?? buildTiers(secrets);
    this.streamer = norm(streamer).replace(/^@/, '');
    this.vectors = vectors;
    this.settings = settings;
    this.scores = scores;
    this.now = now;
    this.rng = rng;
    this.rules = { ...RULES, ...rules };
    this.phase = PHASE.IDLE;
    this.round = null;
    this.roundNo = 0;
    this.prevSecret = null;
    this.nextOverride = null;
    this.breakEndsAt = 0;
    this.seq = 0;
    this.lastGuessAt = new Map();
    this.session = new Map();
    this.streak = { userId: null, count: 0 };
    this.followed = new Set();
    this.joinCardAt = new Map();
    this.cmdAt = new Map();
    this.recentGuessAt = [];
    this.lastHotAt = null;
    this.frozen = false;
    this.frozenAt = 0;
    this.history = [];
  }

  // ------------------------------------------------------------------ settings
  get cooldownMs() {
    return Number.isFinite(this.settings.cooldownMs) ? this.settings.cooldownMs : 2000;
  }

  /** easy | normal | hard. A change applies from the next round. */
  get difficulty() {
    return ['easy', 'hard'].includes(this.settings.difficulty) ? this.settings.difficulty : 'normal';
  }

  /** The words the next secret is drawn from. */
  get pool() {
    return this.tiers[this.difficulty] ?? this.secrets;
  }

  isStreamer(user) {
    if (!this.streamer || !user) return false;
    return norm(user.name).replace(/^@/, '') === this.streamer || norm(user.id).replace(/^@/, '') === this.streamer;
  }

  get hintGift() {
    return this.settings.hintGift || 'Rose';
  }

  // ------------------------------------------------------------------ rounds
  /** Set the next secret (streamer override). Must be a KBBI word. */
  setNextWord(word) {
    const w = norm(word);
    if (!w) {
      this.nextOverride = null;
      return { ok: true };
    }
    if (!this.dict.has(w) && !this.secrets.includes(w)) return { ok: false, error: 'not-in-kbbi' };
    this.nextOverride = w;
    this._changed();
    return { ok: true, word: w };
  }

  startRound() {
    const t = this.now();
    let secret = this.nextOverride;
    this.nextOverride = null;
    if (!secret) secret = this._pickPlayable();
    const r = {
      no: ++this.roundNo,
      secret,
      chars: [...secret],
      wordClass: this.dict.wordClass(secret),
      startedAt: t,
      difficulty: this.difficulty,
      ranker: this.vectors ? this.vectors.ranker(secret) : null,
      revealed: new Map(), // index -> 'gift' | 'free' | 'first' | 'end'
      hintLog: [], // letters in the order they were opened (for the recap)
      firstLetterShown: false,
      freeHintUsed: false,
      closeCalled: false,
      guesses: [],
      byWord: new Map(),
      best: new Map(), // userId -> best entry (helper points)
      giftsBy: new Map(), // viewer id -> hint gifts used this round
      giftCount: 0,
      newestId: null,
      ended: false,
      result: null,
    };
    this.round = r;
    this.prevSecret = secret;
    this.phase = PHASE.PLAYING;
    this.lastGuessAt.clear();
    this.recentGuessAt = [];
    this.lastHotAt = null;
    this._evt('round', { no: r.no, length: r.chars.length, wordClass: r.wordClass, startedAt: t });
    this._changed();
    return r;
  }

  /**
   * A random secret from the pool. With vectors loaded, a word without a vector is skipped (and
   * logged), so every round can be ranked. With no vectors at all, the round still starts: every
   * guess is then out of range.
   */
  _pickPlayable() {
    if (!this.vectors) return pickSecret(this.pool, this.prevSecret, this.rng);
    const skipped = new Set();
    for (let k = 0; k < 50 && skipped.size < this.pool.length; k++) {
      const w = pickSecret(this.pool, this.prevSecret, this.rng);
      if (this.vectors.has(w)) return w;
      if (!skipped.has(w)) {
        skipped.add(w);
        this.emit('note', { text: `Kata rahasia "${w}" tidak punya vektor, dilewati.` });
      }
    }
    const fallback = pickSecret(this.pool, this.prevSecret, this.rng);
    this.emit('note', { text: `Tidak ada kata rahasia yang punya vektor. Ronde memakai "${fallback}" dan semua tebakan di luar jangkauan.` });
    return fallback;
  }

  /** Streamer: drop the current word and start a new round straight away. */
  skip() {
    if (this.round && !this.round.ended) this._end('skip');
    return this.startRound();
  }

  /** Streamer (or the 6-minute timer): show the answer, no points, then the break. */
  reveal(reason = 'reveal') {
    if (this.phase !== PHASE.PLAYING) return false;
    this._end(reason);
    this._evt('reveal', { word: this.round.secret, reason, no: this.round.no, recap: this.round.result.recap });
    this._startBreak();
    return true;
  }

  /** Panic: stop the clock, ignore chat and hide the answer, until unfreeze(). */
  freeze() {
    if (this.frozen) return false;
    this.frozen = true;
    this.frozenAt = this.now();
    this._evt('panic', { on: true });
    this._changed();
    return true;
  }

  /** Resume. The paused time is not counted against the round or the break. */
  unfreeze() {
    if (!this.frozen) return false;
    const paused = this.now() - this.frozenAt;
    this.frozen = false;
    if (this.round && !this.round.ended) this.round.startedAt += paused;
    if (this.phase === PHASE.BREAK) this.breakEndsAt += paused;
    this._evt('panic', { on: false });
    this._changed();
    return true;
  }

  /** What the end-of-round card shows besides the winner: meaning, guess count, runner-up, first hint. */
  _recap(r) {
    const runner = this.sortedGuesses(r).find((g) => g.word !== r.secret) ?? null;
    const first = r.hintLog[0] ?? null;
    return {
      word: r.secret,
      meaning: this.dict.meaning?.(r.secret) ?? null,
      wordClass: r.wordClass,
      guessCount: r.guesses.length,
      players: new Set(r.guesses.map((g) => g.user.id)).size,
      runnerUp: runner
        ? { user: runner.user, word: runner.word, rank: runner.rank ?? null, closeness: runner.closeness ?? null, outOfRange: !!runner.outOfRange }
        : null,
      firstHint: first ? { index: first.index, letter: first.letter, how: first.how, user: first.user ?? null } : null,
    };
  }

  _end(reason, extra = {}) {
    const r = this.round;
    r.ended = true;
    r.endedAt = this.now();
    r.result = { reason, word: r.secret, ...extra, recap: this._recap(r) };
    this.history.unshift({ no: r.no, word: r.secret, reason, winner: extra.winner ?? null, points: extra.points?.total ?? 0, elapsedMs: r.endedAt - r.startedAt, guesses: r.guesses.length });
    this.history.length = Math.min(this.history.length, 8);
    r.chars.forEach((_, i) => {
      if (!r.revealed.has(i)) r.revealed.set(i, 'end');
    });
  }

  _startBreak() {
    this.phase = PHASE.BREAK;
    this.breakEndsAt = this.now() + this.rules.breakMs;
    this._evt('break', { endsAt: this.breakEndsAt });
    this._changed();
  }

  /** Call a few times a second. Fires the hint, the reveal and the end of the break. */
  tick() {
    if (this.frozen) return;
    const t = this.now();
    if (this.phase === PHASE.PLAYING) {
      const r = this.round;
      const elapsed = t - r.startedAt;
      if (!r.firstLetterShown && elapsed >= this.rules.firstLetterMs) {
        r.firstLetterShown = true;
        if (!r.revealed.has(0)) {
          r.revealed.set(0, 'first');
          r.hintLog.push({ index: 0, letter: r.chars[0], how: 'first', user: null, at: t });
        }
        this._evt('hint', { kind: 'first', index: 0, letter: r.chars[0] });
        this._changed();
      }
      if (elapsed >= this.rules.revealMs) this.reveal('timeout');
    } else if (this.phase === PHASE.BREAK && t >= this.breakEndsAt) {
      this.startRound();
    }
  }

  // ------------------------------------------------------------------ chat
  /** A chat message. Returns a status string, which the tests use. */
  handleChat(user, text) {
    if (!user?.id) return 'ignored';
    const cmd = parseCommand(text);
    if (cmd) return this.handleCommand(user, cmd);
    const word = parseGuess(text);
    if (!word) return 'ignored';
    if (this.frozen) return 'frozen';
    if (this.phase !== PHASE.PLAYING) return 'not-playing';
    const t = this.now();
    const last = this.lastGuessAt.get(user.id);
    if (last != null && t - last < this.cooldownMs) return 'cooldown';
    this.lastGuessAt.set(user.id, t);
    const r = this.round;
    if (r.byWord.has(word)) return 'duplicate';
    if (word !== r.secret && !this.dict.has(word)) {
      const lang = this.settings.lang === 'en' ? 'en' : 'id';
      this.emit('reply', { user, text: REPLY_NOT_IN_KBBI[lang], word });
      return 'invalid';
    }
    // the streamer's own correct guess does not end the round, unless they switched that on
    if (word === r.secret && this.isStreamer(user) && !this.settings.streamerCanWin) return 'streamer';
    const entry = {
      id: ++this.seq,
      word,
      user: publicUser(user),
      at: t,
      ...this._score(word, r),
    };
    const first = r.guesses.length === 0;
    r.guesses.push(entry);
    r.byWord.set(word, entry);
    r.newestId = entry.id;
    this._trackBest(r, entry);
    this._evt('guess', { entry, first, win: word === r.secret });
    if (word === r.secret) {
      this._win(user, entry);
      return 'win';
    }
    this._checkClose(r, entry);
    this._noteGuess(t);
    this._changed();
    return 'guess';
  }

  /** The first near-miss of a round gets its own moment (once per round). */
  _checkClose(r, entry) {
    if (r.closeCalled) return;
    const near = entry.rank != null && entry.rank > 1 && entry.rank <= this.rules.closeRank;
    if (!near) return;
    r.closeCalled = true;
    const { id, word, user, rank, closeness: close } = entry;
    this._evt('close', { entry: { id, word, user, rank: rank ?? null, closeness: close ?? null } });
  }

  /** Many guesses in a short window start a "hot streak" (at most one per cooldown). */
  _noteGuess(t) {
    const a = this.recentGuessAt;
    a.push(t);
    while (a.length && t - a[0] > this.rules.hotWindowMs) a.shift();
    if (a.length < this.rules.hotCount) return;
    if (this.lastHotAt != null && t - this.lastHotAt < this.rules.hotCooldownMs) return;
    this.lastHotAt = t;
    this._evt('hot', { count: a.length, windowMs: this.rules.hotWindowMs, until: t + this.rules.hotHoldMs });
  }

  // ------------------------------------------------------------------ commands
  /** True when this key may fire again (and records the time). */
  _cmdGate(key, ms) {
    const t = this.now();
    const last = this.cmdAt.get(key);
    if (last != null && t - last < ms) return false;
    this.cmdAt.set(key, t);
    return true;
  }

  /**
   * !main !hint !top !streak !ronde. TikTok apps cannot reply in chat, so the answer is an
   * overlay card. Every card is throttled per viewer and for the whole chat.
   */
  handleCommand(user, cmd) {
    if (this.frozen) return 'frozen';
    if (cmd === 'main') return this.handleJoinCommand(user);
    if (cmd === 'hint') return this.handleFreeHint(user);
    if (!this._cmdGate(`${cmd}:${user.id}`, this.rules.commandUserMs)) return 'throttled';
    if (!this._cmdGate(cmd, this.rules.commandGlobalMs)) return 'throttled';
    const who = publicUser(user);
    if (cmd === 'top') {
      this._evt('cmd', { cmd, user: who, leaders: this.leaderboard(5) });
      return 'top';
    }
    if (cmd === 'streak') {
      const streak = this.streak.userId === user.id ? this.streak.count : 0;
      const s = this.session.get(user.id);
      this._evt('cmd', { cmd, user: who, streak, wins: s?.wins ?? 0, points: s?.points ?? 0 });
      return 'streak';
    }
    // ronde: time left in the round, or until the next one
    const r = this.round;
    const endsAt = this.phase === PHASE.PLAYING ? r.startedAt + this.rules.revealMs : this.phase === PHASE.BREAK ? this.breakEndsAt : null;
    this._evt('cmd', { cmd, user: who, phase: this.phase, no: this.roundNo, endsAt });
    return 'ronde';
  }

  /** One free letter per round for the whole stream, from one minute in. No points. */
  handleFreeHint(user) {
    if (this.settings.freeHint === false) return 'hint-off';
    if (this.phase !== PHASE.PLAYING) return 'not-playing';
    const r = this.round;
    const opensAt = r.startedAt + this.rules.freeHintAfterMs;
    const t = this.now();
    if (r.freeHintUsed) {
      if (this._cmdGate('hint-used', this.rules.commandGlobalMs)) this._evt('cmd', { cmd: 'hint-used', user: publicUser(user) });
      return 'hint-used';
    }
    if (t < opensAt) {
      if (this._cmdGate('hint-wait', this.rules.commandGlobalMs)) this._evt('cmd', { cmd: 'hint-wait', user: publicUser(user), endsAt: opensAt });
      return 'hint-early';
    }
    const index = this._pickHiddenLetter(r);
    if (index == null) return 'no-letters';
    r.freeHintUsed = true;
    this._openLetter(r, index, 'free', publicUser(user));
    this._evt('hint', { kind: 'free', index, letter: r.chars[index], user: publicUser(user) });
    this._changed();
    return 'hint-free';
  }

  /**
   * A hidden letter to open. Never gives the whole word away: before the 3-minute hint the
   * first letter is saved for that hint, and at least one other letter always stays hidden.
   */
  _pickHiddenLetter(r) {
    const candidates = r.chars.map((_, i) => i).filter((i) => !r.revealed.has(i) && (r.firstLetterShown || i !== 0));
    if (candidates.length < 2) return null;
    return candidates[Math.floor(this.rng() * candidates.length)];
  }

  _openLetter(r, index, how, user = null) {
    r.revealed.set(index, how);
    r.hintLog.push({ index, letter: r.chars[index], how, user, at: this.now() });
  }

  _score(word, r) {
    const rank = r.ranker ? r.ranker.rankOf(word) : word === r.secret ? 1 : null;
    return { rank, closeness: closeness(rank, r.ranker?.size ?? 1), outOfRange: rank == null };
  }

  _trackBest(r, e) {
    if (e.rank == null) return;
    const prev = r.best.get(e.user.id);
    if (!prev || e.rank < prev.rank) r.best.set(e.user.id, e);
  }

  _win(user, entry) {
    const r = this.round;
    const elapsedMs = entry.at - r.startedAt;
    if (this.streak.userId === user.id) this.streak.count++;
    else this.streak = { userId: user.id, count: 1 };
    const points = winPoints({ elapsedMs, streak: this.streak.count });
    this._award(user, points.total, { win: true });
    const helpers = [];
    for (const [uid, best] of r.best) {
      if (uid === user.id) continue;
      const p = helperPoints(best.rank);
      if (!p) continue;
      helpers.push({ user: best.user, rank: best.rank, word: best.word, points: p });
    }
    helpers.sort((a, b) => a.rank - b.rank);
    for (const h of helpers) this._award(h.user, h.points, { helper: true });
    const winner = publicUser(user);
    this._end('win', { winner, points, helpers, elapsedMs, streak: this.streak.count });
    this._evt('win', { no: r.no, word: r.secret, winner, points, helpers, elapsedMs, streak: this.streak.count, recap: r.result.recap });
    if (helpers.length) this._evt('helpers', { helpers });
    if (this.streak.count >= 2) this._evt('streak', { user: winner, count: this.streak.count, bonus: points.streak });
    this._startBreak();
  }

  _award(user, points, { win = false, helper = false } = {}) {
    const t = this.now();
    let s = this.session.get(user.id);
    if (!s) {
      s = { ...publicUser(user), points: 0, wins: 0, reachedAt: 0, order: 0 };
      this.session.set(user.id, s);
    }
    Object.assign(s, publicUser(user), { points: s.points + points, wins: s.wins + (win ? 1 : 0), reachedAt: t, order: ++this.seq });
    this.scores?.add(user, points, { win, helper });
    this._evt('scores', {});
  }

  handleJoinCommand(user) {
    const t = this.now();
    const last = this.joinCardAt.get(user.id);
    if (last != null && t - last < this.rules.joinCardEveryMs) return 'join-throttled';
    this.joinCardAt.set(user.id, t);
    const streak = this.streak.userId === user.id ? this.streak.count : 0;
    const points = this.session.get(user.id)?.points ?? 0;
    this._evt('join', { user: publicUser(user), streak, points });
    return 'join';
  }

  /** A viewer entered the room. No card: entries are far too frequent to show. */
  handleEnter() {
    return 'ok';
  }

  handleFollow(user) {
    if (!user?.id || this.followed.has(user.id)) return 'repeat';
    this.followed.add(user.id);
    this._evt('follow', { user: publicUser(user) });
    return 'follow';
  }

  handleLike(user, count = 1) {
    this._evt('like', { user: user ? publicUser(user) : null, count: Math.max(1, Number(count) || 1) });
    return 'like';
  }

  /**
   * The configured hint gift reveals one hidden letter. One per viewer, three per round, never points.
   * Every other gift (and a hint gift that cannot open a letter) only gets a thank-you chime.
   */
  handleGift(user, giftName, count = 1) {
    if (!user?.id) return 'ignored';
    const thanks = (status) => {
      this._evt('gift', { user: publicUser(user), gift: String(giftName ?? ''), count: Math.max(1, Number(count) || 1) });
      return status;
    };
    if (norm(giftName) !== norm(this.hintGift)) return thanks('other-gift');
    if (this.frozen) return 'frozen';
    if (this.phase !== PHASE.PLAYING) return thanks('not-playing');
    const r = this.round;
    if ((r.giftsBy.get(user.id) ?? 0) >= this.rules.giftHintsPerViewer) return thanks('viewer-limit');
    if (r.giftCount >= this.rules.giftHintsPerRound) return thanks('round-limit');
    const index = this._pickHiddenLetter(r);
    if (index == null) return thanks('no-letters');
    this._openLetter(r, index, 'gift', publicUser(user));
    r.giftsBy.set(user.id, (r.giftsBy.get(user.id) ?? 0) + 1);
    r.giftCount++;
    this._evt('hint', {
      kind: 'gift',
      index,
      letter: r.chars[index],
      user: publicUser(user),
      gift: this.hintGift,
      used: r.giftCount,
      max: this.rules.giftHintsPerRound,
    });
    this._changed();
    return 'hint';
  }

  // ------------------------------------------------------------------ boards
  /** Best first: rank, then the earlier guess. Out-of-range guesses go last, in the order they came. */
  sortedGuesses(r = this.round) {
    if (!r) return [];
    return r.guesses.slice().sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.at - b.at || a.id - b.id);
  }

  /** Session board: points, ties to whoever reached the total first. */
  leaderboard(n = 10) {
    return [...this.session.values()]
      .sort((a, b) => b.points - a.points || a.reachedAt - b.reachedAt || a.order - b.order)
      .slice(0, n)
      .map((s) => ({ ...s, streak: this.streak.userId === s.id ? this.streak.count : 0 }));
  }

  resetSession() {
    this.session.clear();
    this.streak = { userId: null, count: 0 };
    this.followed.clear();
    this.joinCardAt.clear();
    this.cmdAt.clear();
    this._evt('scores', {});
    this._changed();
  }

  clearLeaderboard() {
    this.session.clear();
    this._evt('scores', {});
    this._changed();
  }

  // ------------------------------------------------------------------ state
  publicState() {
    // panic hides the round completely (answer, board, result); the overlay shows a cover
    const r = this.frozen ? null : this.round;
    let round = null;
    if (r) {
      const sorted = this.sortedGuesses(r);
      const newest = r.guesses.find((g) => g.id === r.newestId) || null;
      const best = sorted[0] || null;
      round = {
        no: r.no,
        length: r.chars.length,
        wordClass: r.wordClass,
        startedAt: r.startedAt,
        firstLetterAt: r.startedAt + this.rules.firstLetterMs,
        revealAt: r.startedAt + this.rules.revealMs,
        firstLetterShown: r.firstLetterShown,
        revealed: [...r.revealed].map(([i, how]) => ({ i, ch: r.chars[i], how })),
        difficulty: r.difficulty,
        freeHintOn: this.settings.freeHint !== false,
        freeHintUsed: r.freeHintUsed,
        freeHintAt: r.startedAt + this.rules.freeHintAfterMs,
        giftsUsed: r.giftCount,
        giftsMax: this.rules.giftHintsPerRound,
        guessCount: r.guesses.length,
        lastWord: newest?.word ?? null,
        newest,
        heat: best ? best.closeness : 0,
        board: sorted.slice(0, this.rules.boardSize),
        vocabSize: r.ranker?.size ?? null,
        ended: r.ended,
        result: r.ended ? r.result : null,
      };
    }
    return {
      phase: this.phase,
      panic: this.frozen,
      roundNo: this.roundNo,
      breakEndsAt: this.phase === PHASE.BREAK ? this.breakEndsAt : null,
      round,
      leaderboard: this.leaderboard(10),
      history: this.frozen ? [] : this.history,
      hintGift: this.hintGift,
      cooldownMs: this.cooldownMs,
      serverNow: this.now(),
    };
  }

  /** Everything the streamer sees, including the answer. Never send this to the overlay. */
  controlState() {
    return {
      ...this.publicState(),
      // panic hides the answer here too
      secret: !this.frozen && this.round && !this.round.ended ? this.round.secret : null,
      lastSecret: this.frozen ? null : this.round?.secret ?? null,
      nextOverride: this.frozen ? null : this.nextOverride,
      vectorsAvailable: !!this.vectors,
      secretsCount: this.secrets.length,
      difficulty: this.difficulty,
      tierCounts: { easy: this.tiers.easy.length, normal: this.tiers.normal.length, hard: this.tiers.hard.length },
    };
  }

  _evt(type, data) {
    this.emit('evt', { type, ...data });
  }

  _changed() {
    this.emit('changed');
  }
}

/** The user fields the overlay may show. */
export function publicUser(u) {
  return { id: String(u.id), name: String(u.name || u.id), nick: u.nick ? String(u.nick) : null, avatar: u.avatar || null, sim: !!u.sim };
}
