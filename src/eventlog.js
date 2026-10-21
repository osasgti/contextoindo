// A rotating event log, so a bad night on stream can be debugged afterwards.
//
// One JSON object per line in data/logs/events.log. When the file passes maxBytes it becomes
// events.log.1, the old .1 becomes .2, and so on; only `keep` old files are kept. Writes are
// buffered for a moment so a burst of chat never blocks the game. The logs hold viewer names
// and chat lines, so data/ stays git-ignored.
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export class RotatingLog {
  constructor(dir, { name = 'events.log', maxBytes = 2 * 1024 * 1024, keep = 5, flushMs = 500, now = () => Date.now(), onError = () => {} } = {}) {
    this.dir = dir;
    this.file = dir ? path.join(dir, name) : null;
    this.maxBytes = maxBytes;
    this.keep = Math.max(1, keep);
    this.flushMs = flushMs;
    this.now = now;
    this.onError = onError;
    this.buf = [];
    this.timer = null;
    this.broken = false;
  }

  get enabled() {
    return !!this.file && !this.broken;
  }

  /** Queue one line: { t, kind, ...data }. */
  write(kind, data = {}) {
    if (!this.enabled) return;
    this.buf.push(`${JSON.stringify({ t: new Date(this.now()).toISOString(), kind, ...data })}\n`);
    if (this.buf.length > 5000) this.buf.splice(0, this.buf.length - 5000); // never grow without bound
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushMs);
      this.timer.unref?.();
    }
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.enabled || !this.buf.length) return;
    const text = this.buf.join('');
    this.buf = [];
    try {
      mkdirSync(this.dir, { recursive: true });
      if (existsSync(this.file) && statSync(this.file).size + text.length > this.maxBytes) this.rotate();
      appendFileSync(this.file, text);
    } catch (err) {
      // a full disk or a locked file must never stop the game
      this.broken = true;
      this.onError(err);
    }
  }

  rotate() {
    const last = `${this.file}.${this.keep}`;
    if (existsSync(last)) unlinkSync(last);
    for (let i = this.keep - 1; i >= 1; i--) {
      const from = `${this.file}.${i}`;
      if (existsSync(from)) renameSync(from, `${this.file}.${i + 1}`);
    }
    renameSync(this.file, `${this.file}.1`);
  }

  close() {
    this.flush();
  }
}
