// Event popups: one on screen at a time, the most important first.
// Pure logic with no DOM, shared by the overlay and the tests.

/** Lower number = more important. Reveal ends a round like a win, so it shares the top slot. */
export const POPUP_PRIORITY = {
  winner: 1,
  reveal: 1,
  gift: 2,
  hint: 3,
  close: 3.5, // the first near-miss of a round
  hot: 3.6, // the chat is on fire
  follow: 4,
  cmd: 4.5, // an answer to !top, !ronde, !streak, !hint
  join: 5,
  instructions: 6,
  helper: 7,
  streak: 8,
  thanks: 9, // a thank-you for any other gift
};

/** How long each popup stays fully visible (ms), before it fades out. */
export const POPUP_DURATION = {
  winner: 7000,
  reveal: 5500,
  gift: 4000,
  hint: 4500,
  close: 3800,
  hot: 3000,
  follow: 3000,
  cmd: 4200,
  join: 2600,
  instructions: 6000,
  helper: 4000,
  streak: 3200,
  thanks: 2600,
};

export const FADE_MS = 450;

/** Low-priority popups that waited too long are dropped: a join card from a minute ago is noise. */
export const POPUP_MAX_AGE = {
  close: 15000,
  hot: 8000, // a hot streak that waited 8 seconds is already over
  cmd: 12000,
  thanks: 10000,
  follow: 30000,
  join: 20000,
  instructions: 20000,
  helper: 25000,
  streak: 25000,
};

export class PopupQueue {
  constructor({ maxQueued = 24 } = {}) {
    this.maxQueued = maxQueued;
    this.items = [];
    this.current = null;
    this.seq = 0;
  }

  push(type, data = {}, now = Date.now(), duration) {
    const priority = POPUP_PRIORITY[type];
    if (priority == null) throw new Error(`unknown popup type: ${type}`);
    const item = { id: ++this.seq, type, data, priority, duration: duration ?? POPUP_DURATION[type], queuedAt: now, shownAt: 0 };
    this.items.push(item);
    // over capacity: drop the least important, newest item
    while (this.items.length > this.maxQueued) {
      let worst = 0;
      for (let i = 1; i < this.items.length; i++) {
        const a = this.items[i];
        const b = this.items[worst];
        if (a.priority > b.priority || (a.priority === b.priority && a.id > b.id)) worst = i;
      }
      this.items.splice(worst, 1);
    }
    return item;
  }

  /** Remove queued popups of a type (or all), e.g. stale instructions when a round is skipped. */
  drop(type) {
    this.items = type ? this.items.filter((p) => p.type !== type) : [];
  }

  get size() {
    return this.items.length;
  }

  _takeNext(now) {
    this.items = this.items.filter((p) => !(POPUP_MAX_AGE[p.type] && now - p.queuedAt > POPUP_MAX_AGE[p.type]));
    if (!this.items.length) return null;
    let best = 0;
    for (let i = 1; i < this.items.length; i++) {
      const a = this.items[i];
      const b = this.items[best];
      if (a.priority < b.priority || (a.priority === b.priority && a.id < b.id)) best = i;
    }
    return this.items.splice(best, 1)[0];
  }

  /**
   * Advance the queue. Returns { current, phase } where phase is
   * 'show' (fully visible), 'out' (fading) or null (nothing on screen).
   * A popup is never interrupted: a more important one waits for the current one to finish.
   */
  tick(now = Date.now()) {
    if (this.current && now >= this.current.shownAt + this.current.duration + FADE_MS) this.current = null;
    if (!this.current) {
      const next = this._takeNext(now);
      if (next) {
        next.shownAt = now;
        this.current = next;
      }
    }
    if (!this.current) return { current: null, phase: null };
    const phase = now >= this.current.shownAt + this.current.duration ? 'out' : 'show';
    return { current: this.current, phase };
  }
}
