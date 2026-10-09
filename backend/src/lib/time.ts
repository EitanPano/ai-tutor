export const DAY_MS = 24 * 60 * 60 * 1000

/** Starts a stopwatch: the returned function reads the milliseconds elapsed since this call. */
export function startTimer(): () => number {
  const startedAt = Date.now()
  return () => Date.now() - startedAt
}
