import { sql } from 'kysely'
import type { Db } from '../../lib/db/index.js'
import { ownedBy, type Auth } from '../../lib/ownership.js'

/**
 * Recovers turns whose generation never finished (a crash, a restart past the shutdown timer).
 * Such a turn is an `incomplete` assistant message with a null `stop_reason`: `finish` always
 * sets a stop reason. Once it is older than the generation lock TTL (`ttlSeconds`, passed in by
 * the caller), no live generation can still own it, so it is marked `failed` / `error` together
 * with its question (the latest user message before it in the thread), exactly like a provider
 * error. Failed turns do not count toward the thread cap, the history or progress.
 *
 * Scope: pass `auth` (and optionally `threadId`) for the lazy per-request recovery; pass nothing
 * for the one-off system-wide sweep at boot (the app runs as a single instance). Returns the
 * number of recovered turns.
 */
export async function recoverStaleTurn(
  db: Db,
  ttlSeconds: number,
  scope?: { auth: Auth; threadId?: string }
): Promise<number> {
  return db.transaction().execute(async (trx) => {
    let query = trx
      .selectFrom('message')
      .select(['id', 'thread_id', 'user_id'])
      .where('role', '=', 'assistant')
      .where('status', '=', 'incomplete')
      .where('stop_reason', 'is', null)
      .where(sql<boolean>`created_at < now() - make_interval(secs => ${ttlSeconds})`)
    if (scope) {
      query = query.where(ownedBy('message', scope.auth))
      if (scope.threadId !== undefined) query = query.where('thread_id', '=', scope.threadId)
    }
    const stale = await query.forUpdate().skipLocked().execute()
    let recovered = 0
    for (const row of stale) {
      const auth = { userId: row.user_id }
      const marked = await trx
        .updateTable('message')
        .set({ content: '', status: 'failed', stop_reason: 'error' })
        .where('id', '=', row.id)
        .where(ownedBy('message', auth))
        .where('status', '=', 'incomplete')
        .where('stop_reason', 'is', null)
        .returning('id')
        .executeTakeFirst()
      if (!marked) continue
      recovered += 1
      await trx
        .updateTable('message')
        .set({ status: 'failed' })
        .where(ownedBy('message', auth))
        .where(
          'id',
          '=',
          trx
            .selectFrom('message')
            .select('id')
            .where('thread_id', '=', row.thread_id)
            .where('role', '=', 'user')
            .where('id', '<', row.id)
            .where(ownedBy('message', auth))
            .orderBy('id', 'desc')
            .limit(1)
        )
        .execute()
    }
    return recovered
  })
}
