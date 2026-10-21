// Letter-hint mode: Wordle-style colours plus a warmth value from shared letters.
//   g = right letter, right spot   y = in the word, elsewhere   x = not in the word

export function scoreLetters(guess, secret) {
  const g = [...guess];
  const s = [...secret];
  const out = g.map(() => 'x');
  const left = new Map();
  for (let i = 0; i < s.length; i++) {
    if (g[i] === s[i]) out[i] = 'g';
    else left.set(s[i], (left.get(s[i]) || 0) + 1);
  }
  for (let i = 0; i < g.length; i++) {
    if (out[i] === 'g') continue;
    const k = left.get(g[i]) || 0;
    if (k > 0) {
      out[i] = 'y';
      left.set(g[i], k - 1);
    }
  }
  return out;
}

/** Letters the two words share, counting repeats (multiset intersection). */
export function sharedLetters(guess, secret) {
  const left = new Map();
  for (const ch of secret) left.set(ch, (left.get(ch) || 0) + 1);
  let n = 0;
  for (const ch of guess) {
    const k = left.get(ch) || 0;
    if (k > 0) {
      n++;
      left.set(ch, k - 1);
    }
  }
  return n;
}

/** 0..1. Shared letters over the longer word's length; only the secret itself reaches 1. */
export function warmth(guess, secret) {
  if (guess === secret) return 1;
  const len = Math.max([...guess].length, [...secret].length);
  return Math.min(0.99, sharedLetters(guess, secret) / len);
}

export function letterEntry(guess, secret) {
  const letters = scoreLetters(guess, secret);
  return {
    letters,
    shared: sharedLetters(guess, secret),
    greens: letters.filter((c) => c === 'g').length,
    warmth: warmth(guess, secret),
  };
}
