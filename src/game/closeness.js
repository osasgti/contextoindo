// Closeness: how full the bar is for a guess, from its rank among the N loaded vectors.
//   closeness(rank, N) = 1 - ln(rank) / ln(N), clamped to [0, 1]
// Rank 1 gives 1.0, rank N gives 0. The log curve keeps the top of the board readable: rank 100
// of 100 000 is 0.6, so the first hundred guesses span most of the bar.

/** @param {number|null} rank  1-based rank, or null when the word has no vector (out of range) */
/** @param {number} size       number of vectors that were ranked (N) */
export function closeness(rank, size) {
  if (rank == null || !Number.isFinite(rank)) return 0;
  if (rank <= 1) return 1;
  const n = Math.max(size, 2);
  return Math.max(0, Math.min(1, 1 - Math.log(rank) / Math.log(n)));
}
