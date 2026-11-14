/** Whole hours and minutes until `deadline`, rounded down; null once it passed. */
export function timeLeft(
  deadline: string,
  now: number,
): { hours: number; minutes: number } | null {
  const ms = Date.parse(deadline) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMinutes = Math.floor(ms / 60_000);
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };
}
