// Vector mode: rank every known word by cosine similarity to the secret (1 = the secret).
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

const WORD = /^[a-z]+(?:-[a-z]+)*$/;

export class VectorSpace {
  /** words: string[], data: Float32Array of words.length * dim, rows L2-normalised here. */
  constructor(words, dim, data) {
    this.words = words;
    this.dim = dim;
    this.data = data;
    this.index = new Map(words.map((w, i) => [w, i]));
    for (let i = 0; i < words.length; i++) {
      let s = 0;
      for (let k = 0; k < dim; k++) s += data[i * dim + k] ** 2;
      const inv = s > 0 ? 1 / Math.sqrt(s) : 0;
      for (let k = 0; k < dim; k++) data[i * dim + k] *= inv;
    }
  }

  get size() {
    return this.words.length;
  }

  has(word) {
    return this.index.has(word);
  }

  cosine(a, b) {
    const i = this.index.get(a);
    const j = this.index.get(b);
    if (i == null || j == null) return null;
    let s = 0;
    for (let k = 0; k < this.dim; k++) s += this.data[i * this.dim + k] * this.data[j * this.dim + k];
    return s;
  }

  /** Rank table for one secret. Returns null when the secret has no vector. */
  ranker(secret) {
    const si = this.index.get(secret);
    if (si == null) return null;
    const n = this.size;
    const d = this.dim;
    const sims = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = 0; k < d; k++) s += this.data[i * d + k] * this.data[si * d + k];
      sims[i] = s;
    }
    sims[si] = Infinity; // the secret is always rank 1, even with duplicate vectors
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => sims[b] - sims[a]);
    const ranks = new Int32Array(n);
    order.forEach((idx, r) => (ranks[idx] = r + 1));
    return {
      size: n,
      rankOf: (word) => {
        const i = this.index.get(word);
        return i == null ? null : ranks[i];
      },
    };
  }

  static fromObject(obj) {
    const words = Object.keys(obj);
    const dim = words.length ? obj[words[0]].length : 0;
    const data = new Float32Array(words.length * dim);
    words.forEach((w, i) => data.set(obj[w], i * dim));
    return new VectorSpace(words, dim, data);
  }
}

/** 0..1 bar fill from a rank, on a log scale (rank 1 = full). */
export function closeness(rank, size) {
  if (rank == null) return 0;
  if (rank <= 1) return 1;
  return Math.max(0, Math.min(0.99, 1 - Math.log(rank) / Math.log(Math.max(size, 2))));
}

/**
 * Load a word2vec text file (first line "count dim", then "word v1 v2 ...").
 * Keeps only plain words found in `vocab` (the KBBI set) and reads at most `maxLines` lines,
 * since files like cc.id.300.vec are sorted by frequency and hold millions of rows.
 */
export async function loadVectors(file, { vocab = null, maxLines = 200000, log = () => {} } = {}) {
  if (!existsSync(file)) throw new Error(`VECTORS_PATH file not found: ${file}`);
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let dim = 0;
  let lineNo = 0;
  const words = [];
  const chunks = [];
  const seen = new Set(); // "Rumah" and "rumah" both lowercase to one word: keep the first (most frequent)
  for await (const line of rl) {
    lineNo++;
    if (lineNo === 1) {
      const head = line.trim().split(/\s+/);
      if (head.length === 2 && head.every((x) => /^\d+$/.test(x))) {
        dim = Number(head[1]);
        continue;
      }
    }
    if (lineNo > maxLines) break;
    const sp = line.indexOf(' ');
    if (sp <= 0) continue;
    const w = line.slice(0, sp).toLowerCase();
    if (seen.has(w) || !WORD.test(w) || (vocab && !vocab.has(w))) continue;
    const parts = line.slice(sp + 1).trim().split(' ');
    if (!dim) dim = parts.length;
    if (parts.length !== dim) continue;
    seen.add(w);
    words.push(w);
    chunks.push(Float32Array.from(parts, Number));
  }
  rl.close();
  const data = new Float32Array(words.length * dim);
  chunks.forEach((v, i) => data.set(v, i * dim));
  log(`[vectors] ${words.length} words x ${dim} dims from ${file}`);
  return new VectorSpace(words, dim, data);
}
