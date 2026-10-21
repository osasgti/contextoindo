// All-time board, saved in data/scores.json (git-ignored).
// Simulator players are stored with sim: true and never shown or exported.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export class ScoreStore {
  constructor(file, { now = () => Date.now(), saveDelayMs = 1500 } = {}) {
    this.file = file;
    this.now = now;
    this.saveDelayMs = saveDelayMs;
    this.players = new Map();
    this.timer = null;
    this.load();
  }

  load() {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8'));
      for (const p of data.players || []) this.players.set(String(p.id), p);
    } catch (err) {
      console.error(`[scores] could not read ${this.file}: ${err.message}. Starting empty.`);
    }
  }

  add(user, points, { win = false } = {}) {
    if (!points && !win) return;
    const id = String(user.id);
    const p = this.players.get(id) || { id, name: user.name || id, points: 0, wins: 0, sim: !!user.sim, firstAt: this.now() };
    p.name = user.name || p.name;
    p.points += points;
    p.wins += win ? 1 : 0;
    p.sim = !!user.sim;
    p.updatedAt = this.now();
    this.players.set(id, p);
    this._scheduleSave();
  }

  /** Real viewers only, most points first; ties to whoever got there first. */
  top(n = 50) {
    return [...this.players.values()]
      .filter((p) => !p.sim)
      .sort((a, b) => b.points - a.points || (a.updatedAt ?? 0) - (b.updatedAt ?? 0))
      .slice(0, n);
  }

  get count() {
    return this.top(Infinity).length;
  }

  reset() {
    this.players.clear();
    this.saveNow();
  }

  toCsv() {
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = ['rank,id,name,points,wins'];
    this.top(Infinity).forEach((p, i) => lines.push([i + 1, p.id, p.name, p.points, p.wins].map(esc).join(',')));
    return lines.join('\r\n') + '\r\n';
  }

  _scheduleSave() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.saveNow();
    }, this.saveDelayMs);
    this.timer.unref?.();
  }

  saveNow() {
    if (!this.file) return;
    clearTimeout(this.timer);
    this.timer = null;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const data = { version: 1, savedAt: new Date(this.now()).toISOString(), players: [...this.players.values()] };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 1));
    renameSync(tmp, this.file);
  }
}
