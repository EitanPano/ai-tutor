import { sql } from 'kysely'
import type { Db } from '../lib/db/index.js'
import { conflict } from '../lib/error.js'
import type { Auth } from './ownership.js'

/**
 * Per-user generation lock, shared by explain, guide and quiz generation. A lock older than five
 * minutes is stale (the holder crashed) and is taken over.
 */
export async function acquireGenerationLock(db: Db, auth: Auth): Promise<void> {
  const { rows } = await sql<{ id: string }>`
    UPDATE app_user SET generation_started_at = now()
    WHERE id = ${auth.userId}
      AND (generation_started_at IS NULL OR generation_started_at < now() - interval '5 minutes')
    RETURNING id`.execute(db)
  if (rows.length === 0) {
    throw conflict(
      'generation_in_progress',
      'Another answer is still being generated. Wait for it to finish.'
    )
  }
}

export async function releaseGenerationLock(db: Db, auth: Auth): Promise<void> {
  await db
    .updateTable('app_user')
    .set({ generation_started_at: null })
    .where('id', '=', auth.userId)
    .execute()
}
