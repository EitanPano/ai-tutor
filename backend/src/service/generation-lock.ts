import { sql } from 'kysely'
import type { Db } from '../lib/db/index.js'
import { conflict } from '../lib/error.js'
import type { Auth } from './ownership.js'

/** Identifies one acquisition: the exact `generation_started_at` it wrote, as microsecond text. */
export type GenerationLockToken = string

/**
 * Per-user generation lock, shared by explain, guide and quiz generation. A lock older than five
 * minutes is stale (the holder crashed) and is taken over. Returns the token to release with.
 */
export async function acquireGenerationLock(db: Db, auth: Auth): Promise<GenerationLockToken> {
  const { rows } = await sql<{ token: string }>`
    UPDATE app_user SET generation_started_at = now()
    WHERE id = ${auth.userId}
      AND (generation_started_at IS NULL OR generation_started_at < now() - interval '5 minutes')
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
 * lock was taken over after 5 minutes cannot free the new holder's lock.
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
