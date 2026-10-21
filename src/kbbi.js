// KBBI dictionary: the valid-guess list and each word's class (Nomina, Verba, ...).
import { existsSync, readFileSync } from 'node:fs';

const TAG_SEP = ' | ';

/**
 * RFC 4180 CSV parser (quoted fields may hold commas, quotes and newlines).
 * Calls onRow(array of strings) for every record, the header included.
 */
export function parseCsv(text, onRow) {
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let row = [];
  while (i < n) {
    let value;
    if (text.charCodeAt(i) === 34) {
      // quoted field: copy chunks between quotes, "" is an escaped quote
      let j = i + 1;
      value = '';
      for (;;) {
        const q = text.indexOf('"', j);
        if (q === -1) {
          value += text.slice(j);
          i = n;
          break;
        }
        value += text.slice(j, q);
        if (text.charCodeAt(q + 1) === 34) {
          value += '"';
          j = q + 2;
          continue;
        }
        i = q + 1;
        break;
      }
      // skip anything stray between the closing quote and the delimiter
      while (i < n) {
        const d = text.charCodeAt(i);
        if (d === 44 || d === 10 || d === 13) break;
        i++;
      }
    } else {
      let j = i;
      while (j < n) {
        const d = text.charCodeAt(j);
        if (d === 44 || d === 10 || d === 13) break;
        j++;
      }
      value = text.slice(i, j);
      i = j;
    }
    row.push(value);
    if (text.charCodeAt(i) === 44) {
      i++;
      if (i >= n) row.push('');
      continue;
    }
    if (text.charCodeAt(i) === 13) i++;
    if (text.charCodeAt(i) === 10) i++;
    onRow(row);
    row = [];
  }
  if (row.length) onRow(row);
}

export const normalizeWord = (w) => String(w ?? '').trim().toLowerCase();

/** First value of a multi-value KBBI tag column ("Nomina | Verba" -> "Nomina"). */
export function firstTag(value) {
  for (const part of String(value ?? '').split(TAG_SEP)) {
    const t = part.trim();
    if (t) return t;
  }
  return null;
}

const MEANING_MAX = 140;

/**
 * One sense as plain text. KBBI leaves empty ";" and ":" placeholders ("makanan: ; ; ;"),
 * so parts with no letters are dropped and the rest are joined with "; ".
 */
function senseText(part) {
  return part
    .split(';')
    .map((p) => p.replace(/\s+/g, ' ').trim().replace(/[\s:,]+$/, ''))
    .filter((p) => /\p{L}/u.test(p))
    .join('; ');
}

/**
 * One short line from a "makna" cell: the first sense, without its number, cut at a word
 * boundary. Senses may be split by a newline or " | ". Returns null when nothing is left.
 */
export function cleanMeaning(raw, max = MEANING_MAX) {
  const s = String(raw ?? '')
    .replace(/\[[^\]]*\]/g, '\n') // "[n]" class tags start a new sense
    .replace(/(^|\s)\(?\d{1,2}[.)](?=\s|$)/g, '\n') // "1." and "(2)" sense numbers
    .split(/\r?\n|\s\|\s/)
    .map(senseText)
    .find(Boolean);
  if (!s) return null;
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

/**
 * Build the dictionary from CSV text. Words are lowercased and kept in a Set.
 * Meanings (the "makna" column) take memory, so only words in `meaningFor` keep one.
 */
export function buildKbbi(text, { meaningFor = null } = {}) {
  let header = null;
  let ki = -1;
  let ci = -1;
  let mi = -1;
  let rows = 0;
  const words = new Set();
  const classOf = new Map();
  const meanings = new Map();
  const wantMeaning = meaningFor ? (meaningFor instanceof Set ? meaningFor : new Set(meaningFor)) : null;
  parseCsv(text, (row) => {
    if (!header) {
      header = row.map((h) => h.trim().toLowerCase());
      ki = header.indexOf('kata');
      ci = header.indexOf('tags_kelas');
      mi = header.indexOf('makna');
      if (ki < 0) throw new Error('KBBI CSV has no "kata" column');
      return;
    }
    if (row.length === 1 && row[0] === '') return;
    rows++;
    const kata = normalizeWord(row[ki]);
    if (!kata) return;
    words.add(kata);
    // KBBI splits one headword over several rows: keep the first class we see
    if (ci >= 0 && !classOf.has(kata)) {
      const cls = firstTag(row[ci]);
      if (cls) classOf.set(kata, cls);
    }
    if (wantMeaning && mi >= 0 && wantMeaning.has(kata) && !meanings.has(kata)) {
      const m = cleanMeaning(row[mi]);
      if (m) meanings.set(kata, m);
    }
  });
  return {
    rows,
    words,
    size: words.size,
    has: (w) => words.has(w),
    wordClass: (w) => classOf.get(w) || null,
    /** Short meaning, or null (no makna column, or the word is not in meaningFor). */
    meaning: (w) => meanings.get(w) || null,
  };
}

export function loadKbbi(file, opts) {
  if (!existsSync(file)) {
    throw new Error(
      `KBBI CSV not found at ${file}\n` +
        '  Put kbbi.csv in the data/ folder, or set KBBI_CSV to its path.\n' +
        '  To try the game without it, run: npm run demo',
    );
  }
  return buildKbbi(readFileSync(file, 'utf8'), opts);
}
