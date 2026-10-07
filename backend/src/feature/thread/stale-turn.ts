import { sql, type RawBuilder } from 'kysely'
import type { Db } from '../../lib/db/index.js'
import { ownedBy, type Auth } from '../../lib/ownership.js'

/** The lazy-recovery cutoff: turns older than the generation lock TTL. */
export function olderThanTtl(ttlSeconds: number): RawBuilder<Date> {
  return sql<Date>`now() - make_interval(secs => ${ttlSeconds})`
}

/**
 * Recovers turns whose generation never finished (a crash, a restart past the shutdown timer).
 * Such a turn is an `incomplete` assistant message with a null `stop_reason`: `finish` always
 * sets a stop reason. Once it is older than `cutoff` (a timestamp expression chosen by the caller),
 * no live generation can still own it, so it is marked `failed` / `error` together
 * with its question (the latest user message before it in the thread), exactly like a provider
 * error. Failed turns do not count toward the thread cap, the history or progress.
 *
 * Lazy per-request recovery passes `auth` (and optionally `threadId`) and a cutoff of now minus the
 * generation lock TTL, because a younger turn may still be live. The one-off system-wide sweep at
 * boot passes no scope and a cutoff of `now()`: nothing of this process has started yet, so every
 * unfinished turn belongs to a dead one (the app runs as a single instance). Returns the number
 * of recovered turns.
 */
export async function recoverStaleTurn(
  db: Db,
  cutoff: RawBuilder<Date>,
  scope?: { auth: Auth; threadId?: string }
): Promise<number> {
  return db.transaction().execute(async (trx) => {
    let query = trx
      .selectFrom('message')
      .select(['id', 'thread_id', 'user_id'])
      .where('role', '=', 'assistant')
      .where('status', '=', 'incomplete')
      .where('stop_reason', 'is', null)
      .where(sql<boolean>`created_at < ${cutoff}`)
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
