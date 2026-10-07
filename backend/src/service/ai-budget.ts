import { sql } from 'kysely'
import type { Db } from '../lib/db/index.js'
import type { NewAiCall } from '../lib/db/schema.js'
import { AppError } from '../lib/error.js'
import { ownedBy, type Auth } from './ownership.js'

/**
 * Throws 429 `ai_budget_exceeded` once the tokens (input, cache creation, cache read and output)
 * recorded in `ai_call` since
 * the start of today, in the user's time zone, reach `budget`.
 */
export async function assertWithinBudget(db: Db, auth: Auth, budget: number): Promise<void> {
  // The user's own row holds the time zone; the ledger rows go through the ownership helper.
  const userTimeZone = sql<string>`(SELECT time_zone FROM app_user WHERE id = ${auth.userId})`
  const row = await db
    .selectFrom('ai_call')
    .select(
      sql<string>`COALESCE(SUM(input_token::bigint + cache_creation_token + cache_read_token + output_token), 0)::text`.as(
        'used'
      )
    )
    .where(ownedBy('ai_call', auth))
    .where(
      sql<boolean>`created_at >= (date_trunc('day', now() AT TIME ZONE ${userTimeZone}) AT TIME ZONE ${userTimeZone})`
    )
    .executeTakeFirst()
  const used = Number(row?.used ?? 0)
  if (used >= budget) {
    throw new AppError(
      429,
      'ai_budget_exceeded',
      "You've used today's AI budget. It resets at midnight in your time zone."
    )
  }
}

export type AiCallRecord = Omit<NewAiCall, 'id' | 'user_id' | 'created_at'>

/** Appends one row to the `ai_call` ledger. Pass `trx` to record inside a transaction. */
export async function recordAiCall(db: Db, auth: Auth, row: AiCallRecord): Promise<void> {
  await db
    .insertInto('ai_call')
    .values({ ...row, user_id: auth.userId })
    .execute()
}
