import { sql } from 'kysely'
import type { Db } from '../lib/db/index.js'
import type { NewAiCall } from '../lib/db/schema.js'
import { AppError } from '../lib/error.js'
import type { Auth } from './ownership.js'

/**
 * Throws 429 `ai_budget_exceeded` once the tokens (input, cache creation, cache read and output)
 * recorded in `ai_call` since
 * the start of today, in the user's time zone, reach `budget`.
 */
export async function assertWithinBudget(db: Db, auth: Auth, budget: number): Promise<void> {
  const { rows } = await sql<{ used: string }>`
    SELECT COALESCE(SUM(c.input_token + c.cache_creation_token + c.cache_read_token + c.output_token), 0)::text AS used
    FROM app_user u
    LEFT JOIN ai_call c
      ON c.user_id = u.id
     AND c.created_at >= (date_trunc('day', now() AT TIME ZONE u.time_zone) AT TIME ZONE u.time_zone)
    WHERE u.id = ${auth.userId}`.execute(db)
  const used = Number(rows[0]?.used ?? 0)
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
