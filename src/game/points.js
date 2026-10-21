// Points rules.
export const WIN_BASE = 100;
export const SPEED_MAX = 50;
export const SPEED_WINDOW_MS = 180000; // the speed bonus is gone by the first-letter hint (3 min)
export const STREAK_STEP = 10;
export const STREAK_MAX = 30;

/** +50 at 0 s falling linearly to 0 at 3 minutes. */
export function speedBonus(elapsedMs) {
  const e = Math.max(0, elapsedMs);
  if (e >= SPEED_WINDOW_MS) return 0;
  return Math.round(SPEED_MAX * (1 - e / SPEED_WINDOW_MS));
}

/** streak = consecutive wins including this one. 2nd win +10, 3rd +20, 4th and on +30. */
export function streakBonus(streak) {
  if (streak < 2) return 0;
  return Math.min(STREAK_MAX, STREAK_STEP * (streak - 1));
}

/** Vector mode: the best guess of a non-winner. Rank 2-3 = 10, rank 4-10 = 5. */
export function helperPoints(rank) {
  if (rank == null) return 0;
  if (rank >= 2 && rank <= 3) return 10;
  if (rank >= 4 && rank <= 10) return 5;
  return 0;
}

export function winPoints({ elapsedMs, streak }) {
  const base = WIN_BASE;
  const speed = speedBonus(elapsedMs);
  const bonus = streakBonus(streak);
  return { base, speed, streak: bonus, total: base + speed + bonus };
}
