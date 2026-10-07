import { sql } from 'kysely'
import type { Db } from '../../lib/db/index.js'
import { conflict } from '../../lib/error.js'
import type { Auth } from '../../lib/ownership.js'

/**
 * How long a generation lock (and an in-flight assistant placeholder) is trusted before it counts
 * as abandoned. It must exceed the worst-case generation: a provider call may take 60 s per SDK
 * attempt (3 attempts: 1 + 2 retries) and guide/quiz generation makes up to 2 such calls
 * (`MAX_ATTEMPTS`), so about 6 minutes. Ten minutes leaves headroom; a unit test ties the numbers.
 */
export const GENERATION_LOCK_TTL_SECONDS = 600

/** Identifies one acquisition: the exact `generation_started_at` it wrote, as microsecond text. */
export type GenerationLockToken = string

/**
 * Per-user generation lock, shared by explain, guide and quiz generation. A lock older than the
 * TTL is stale (the holder crashed) and is taken over. Returns the token to release with.
 */
export async function acquireGenerationLock(db: Db, auth: Auth): Promise<GenerationLockToken> {
  const { rows } = await sql<{ token: string }>`
    UPDATE app_user SET generation_started_at = now()
    WHERE id = ${auth.userId}
      AND (generation_started_at IS NULL OR generation_started_at < now() - make_interval(secs => ${GENERATION_LOCK_TTL_SECONDS}))
    RETURNING generation_started_at::text AS token`.execute(db)
  const token = rows[0]?.token
  if (token === undefined) {
    throw conflict(
      'generation_in_progress',
      'Another answer is still being generated. Wait for it to finish.'
    )
  }
  return token
}

/**
 * Releases the lock only while `token` still owns it, so a late release from a generation whose
 * lock was taken over after the TTL cannot free the new holder's lock.
 */
export async function releaseGenerationLock(
  db: Db,
  auth: Auth,
  token: GenerationLockToken
): Promise<void> {
  await sql`
    UPDATE app_user SET generation_started_at = NULL
    WHERE id = ${auth.userId} AND generation_started_at = ${token}::timestamptz`.execute(db)
}

/**
 * Clears every held lock and returns how many there were. Only for boot, before the first request:
 * with one backend instance, every lock still set then belongs to a process that no longer exists.
 */
export async function releaseAllGenerationLocks(db: Db): Promise<number> {
  const result = await sql`
    UPDATE app_user SET generation_started_at = NULL
    WHERE generation_started_at IS NOT NULL`.execute(db)
  return Number(result.numAffectedRows ?? 0)
}
