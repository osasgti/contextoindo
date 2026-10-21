// Secret answers: data/secret_words.txt, built by scripts/build_secret_words.py.
import { existsSync, readFileSync } from 'node:fs';
import { normalizeWord } from './kbbi.js';

export function parseSecretList(text) {
  const seen = new Set();
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const w = normalizeWord(line);
    if (!w || w.startsWith('#') || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

export function loadSecrets(file) {
  if (!existsSync(file)) {
    throw new Error(
      `Secret word list not found at ${file}\n` +
        '  Build it with: python scripts/build_secret_words.py (reads data/kbbi.csv)',
    );
  }
  const list = parseSecretList(readFileSync(file, 'utf8'));
  if (!list.length) throw new Error(`Secret word list ${file} is empty`);
  return list;
}

/** An optional extra list (easy / hard). A missing or empty file is not an error. */
export function loadOptionalList(file) {
  if (!file || !existsSync(file)) return null;
  const list = parseSecretList(readFileSync(file, 'utf8'));
  return list.length ? list : null;
}

export const TIERS = ['easy', 'normal', 'hard'];
const TIER_MIN = 20; // a derived tier smaller than this is not worth switching to

/**
 * The word pool for each difficulty. "normal" is the whole list. "easy" and "hard" come from
 * their own files when those exist; otherwise easy is words of 5 letters or fewer and hard is
 * words of 8 letters or more. A derived tier with fewer than 20 words falls back to normal.
 */
export function buildTiers(list, { easy = null, hard = null } = {}) {
  const len = (w) => [...w].length;
  const derive = (fn) => {
    const out = list.filter((w) => fn(len(w)));
    return out.length >= TIER_MIN ? out : list;
  };
  return {
    easy: easy?.length ? easy : derive((n) => n <= 5),
    normal: list,
    hard: hard?.length ? hard : derive((n) => n >= 8),
  };
}

/** Random secret that differs from the previous round's word (when the list allows it). */
export function pickSecret(list, previous = null, rng = Math.random) {
  if (!list.length) throw new Error('no secret words');
  if (list.length === 1) return list[0];
  for (let tries = 0; tries < 20; tries++) {
    const w = list[Math.floor(rng() * list.length)];
    if (w !== previous) return w;
  }
  return list.find((w) => w !== previous);
}
