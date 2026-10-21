// Competition ranking over similarities: the best value is rank 1, equal values share a rank,
// and the next distinct value skips the shared places (1, 2, 2, 4).

/**
 * @param {Float32Array} sims  similarity of every vocabulary word to the secret
 * @param {number} selfIndex   index of the secret itself (always rank 1)
 * @returns {Int32Array}       rank of every word, 1-based
 */
export function competitionRanks(sims, selfIndex) {
  const n = sims.length;
  const score = Float32Array.from(sims);
  if (selfIndex != null && selfIndex >= 0 && selfIndex < n) score[selfIndex] = Infinity;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  // sort indices by score, best first; the array sort is stable, so equal scores keep index order
  const sorted = Array.from(order).sort((a, b) => score[b] - score[a] || a - b);
  const ranks = new Int32Array(n);
  let rank = 0;
  let prev = null;
  for (let pos = 0; pos < n; pos++) {
    const idx = sorted[pos];
    if (prev === null || score[idx] !== prev) {
      rank = pos + 1;
      prev = score[idx];
    }
    ranks[idx] = rank;
  }
  return ranks;
}
