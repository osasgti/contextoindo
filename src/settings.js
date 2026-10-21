// Streamer settings, saved in data/settings.json so they survive restarts.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_SETTINGS = {
  hintGift: 'Rose',
  tts: false,
  lang: 'id',
  dark: true,
  cooldownMs: 2000,
  layout: 'landscape',
  sound: true,
  musicVol: 0.25,
  sfxVol: 0.6,
  boardTop: 5,
  difficulty: 'normal', // easy | normal | hard, from the next round on
  freeHint: true, // viewers may type !hint (once per round, for the whole stream)
  streamerCanWin: false, // the streamer's own correct guess is ignored unless this is on
  reduceFlash: false, // no shake, strobing or big pulses on the overlay
  sceneSafe: false, // the overlay shows aliases instead of viewer names
  mutedFx: [], // sound effects switched off one by one
};

/** Every effect the overlay can play; the control page lists them and can mute each one. */
export const FX_NAMES = [
  'tick', 'hot', 'cold', 'flip', 'best', 'close', 'hotstreak', 'gift', 'bell', 'fanfare', 'countdown', 'heartbeat', 'reveal', 'breakSweep', 'roundStart', 'command',
];

const clamp01 = (v, d) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : d);

/** Accept only known keys with sane values. */
export function sanitize(patch, base = DEFAULT_SETTINGS) {
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) {
    switch (k) {
      case 'hintGift': {
        const s = String(v ?? '').trim().slice(0, 40);
        if (s) out.hintGift = s;
        break;
      }
      case 'tts':
      case 'dark':
      case 'sound':
      case 'freeHint':
      case 'streamerCanWin':
      case 'reduceFlash':
      case 'sceneSafe':
        out[k] = !!v;
        break;
      case 'difficulty':
        if (['easy', 'normal', 'hard'].includes(v)) out.difficulty = v;
        break;
      case 'mutedFx':
        out.mutedFx = Array.isArray(v) ? [...new Set(v.filter((n) => FX_NAMES.includes(n)))] : [];
        break;
      case 'lang':
        out.lang = v === 'en' ? 'en' : 'id';
        break;
      case 'layout':
        out.layout = v === 'portrait' ? 'portrait' : 'landscape';
        break;
      case 'cooldownMs': {
        const n = Math.round(Number(v));
        if (Number.isFinite(n)) out.cooldownMs = Math.max(0, Math.min(30000, n));
        break;
      }
      case 'musicVol':
      case 'sfxVol':
        out[k] = clamp01(v, base[k]);
        break;
      case 'boardTop':
        out.boardTop = Number(v) === 10 ? 10 : 5;
        break;
      default:
    }
  }
  return out;
}

export class SettingsStore {
  constructor(file, overrides = {}) {
    this.file = file;
    this.values = { ...DEFAULT_SETTINGS, ...sanitize(overrides) };
    if (file && existsSync(file)) {
      try {
        Object.assign(this.values, sanitize(JSON.parse(readFileSync(file, 'utf8'))));
      } catch (err) {
        console.error(`[settings] could not read ${file}: ${err.message}. Using defaults.`);
      }
    }
  }

  update(patch) {
    const clean = sanitize(patch, this.values);
    Object.assign(this.values, clean);
    this.save();
    return clean;
  }

  save() {
    if (!this.file) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.values, null, 2));
    renameSync(tmp, this.file);
  }
}
