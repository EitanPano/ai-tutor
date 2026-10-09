import { sql } from 'kysely'
import type { Db } from '../../lib/db/index.js'
import type { AiCallTable, MessageStopReason } from '../../lib/db/schema.js'
import { serviceUnavailable, tooManyRequests } from '../../lib/error.js'
import { ownedBy, type Auth } from '../../lib/ownership.js'
import type { TutorUsage } from '../../lib/tutor/tutor.js'

const TOKEN_SUM = sql<string>`COALESCE(SUM(input_token::bigint + cache_creation_token + cache_read_token + output_token), 0)::text`

/**
 * Throws 429 `ai_budget_exceeded` once the tokens (input, cache creation, cache read and output)
 * recorded in `ai_call` since the start of today, in the user's time zone, reach `budget`. Then
 * throws 503 `ai_unavailable` once all users together reach `globalBudget` since UTC midnight.
 */
export async function assertWithinBudget(
  db: Db,
  auth: Auth,
  budget: number,
  globalBudget: number
): Promise<void> {
  // The user's own row holds the time zone; the ledger rows go through the ownership helper.
  const userTimeZone = sql<string>`(SELECT time_zone FROM app_user WHERE id = ${auth.userId})`
  const row = await db
    .selectFrom('ai_call')
    .select(TOKEN_SUM.as('used'))
    .where(ownedBy('ai_call', auth))
    .where(
      sql<boolean>`created_at >= (date_trunc('day', now() AT TIME ZONE ${userTimeZone}) AT TIME ZONE ${userTimeZone})`
    )
    .executeTakeFirst()
  const used = Number(row?.used ?? 0)
  if (used >= budget) {
    throw tooManyRequests(
      'ai_budget_exceeded',
      "You've used today's AI budget. It resets at midnight in your time zone."
    )
  }

  // Deliberately reads across users, so it skips the ownership helper: the global cap is a total
  // over the whole ledger, and `ai` owns `ai_call`. The window is UTC, not the user's zone.
  const global = await db
    .selectFrom('ai_call')
    .select(TOKEN_SUM.as('used'))
    .where(
      sql<boolean>`created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`
    )
    .executeTakeFirst()
  if (Number(global?.used ?? 0) >= globalBudget) {
    throw serviceUnavailable(
      'ai_unavailable',
      'AI features are paused for today. Try again tomorrow.'
    )
  }
}

/** One provider call, as callers describe it. `recordAiCall` is the only place that knows the `ai_call` columns. */
export type AiCall = {
  kind: AiCallTable['kind']
  model: string
  usage: TutorUsage
  stopReason: MessageStopReason
  refusalCategory: string | null
  latencyMs: number
}

/** Appends one row to the `ai_call` ledger. */
export async function recordAiCall(db: Db, auth: Auth, call: AiCall): Promise<void> {
  await db
    .insertInto('ai_call')
    .values({
      user_id: auth.userId,
      kind: call.kind,
      model: call.model,
      input_token: call.usage.inputTokens,
      output_token: call.usage.outputTokens,
      cache_read_token: call.usage.cacheReadTokens,
      cache_creation_token: call.usage.cacheCreationTokens,
      stop_reason: call.stopReason,
      refusal_category: call.refusalCategory,
      latency_ms: Math.max(0, Math.round(call.latencyMs))
    })
    .execute()
}
