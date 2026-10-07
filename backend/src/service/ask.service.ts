import { sql } from 'kysely'
import type { Config } from '../lib/config.js'
import type { Db } from '../lib/db/index.js'
import { conflict } from '../lib/error.js'
import type { Logger } from '../lib/logger.js'
import type { ExplainResult, TutorTurn, TutorUsage } from '../lib/tutor/tutor.js'
import { ZERO_USAGE } from '../lib/tutor/tutor.js'
import { assertAiEnabled } from './ai-guard.js'
import { assertWithinBudget, recordAiCall } from './ai-budget.js'
import {
  acquireGenerationLock,
  releaseGenerationLock,
  type GenerationLockToken
} from './generation-lock.js'
import { ownedBy, type Auth } from './ownership.js'
import { DEFAULT_TITLE, requireThread } from './thread.service.js'
import { recoverStaleTurn } from './stale-turn.js'
import { requireTopic } from './topic.service.js'

/** A thread holds at most 25 non-failed messages (ledger ruling 14). */
export const MAX_THREAD_MESSAGES = 25
const MAX_TITLE_CHARS = 80

export type AskContext = {
  threadId: string
  userMessageId: string
  assistantMessageId: string
  lockToken: GenerationLockToken
  topicName: string
  history: TutorTurn[]
}

export type AskOutcome =
  | { kind: 'result'; result: ExplainResult; latencyMs: number }
  | { kind: 'error'; model: string; latencyMs: number; usage?: TutorUsage }

/**
 * The thread title: the first non-empty line that is not a code fence, whitespace collapsed.
 * Over 80 characters it is cut at the last word boundary within 79 characters and gets an
 * ellipsis (a single long word is cut hard). The default title when no such line exists.
 */
export function titleFrom(content: string): string {
  const line = content
    .split(/\r?\n/)
    .map((raw) => raw.replace(/\s+/g, ' ').trim())
    .find((text) => text !== '' && !text.startsWith('```'))
  if (line === undefined) return DEFAULT_TITLE
  if (line.length <= MAX_TITLE_CHARS) return line
  const head = line.slice(0, MAX_TITLE_CHARS - 1)
  const boundary = head.lastIndexOf(' ')
  return `${(boundary > 0 ? head.slice(0, boundary) : head).trimEnd()}…`
}

/**
 * Earlier turns, oldest first, as the model should see them. Failed turns are left out (on
 * failure both messages of the turn are `failed`), and so are assistant messages with no text.
 * `incomplete` answers are sent as they are.
 */
export async function buildHistory(db: Db, auth: Auth, threadId: string): Promise<TutorTurn[]> {
  const rows = await db
    .selectFrom('message')
    .select(['role', 'content'])
    .where('thread_id', '=', threadId)
    .where(ownedBy('message', auth))
    .where('status', '<>', 'failed')
    .orderBy('created_at')
    .orderBy('id')
    .execute()
  return rows.filter((row) => row.role === 'user' || row.content !== '')
}

/**
 * Validates everything that can reject the request, takes the generation lock and persists the
 * user message plus an `incomplete` assistant placeholder. Throws an AppError on any rejection
 * (the lock is only held when this returns). The caller MUST call `finishAsk` afterwards.
 */
export async function startAsk(
  db: Db,
  auth: Auth,
  config: Pick<Config, 'aiEnabled' | 'aiDailyTokenBudget'>,
  threadId: string,
  content: string
): Promise<AskContext> {
  assertAiEnabled(config)
  // A crashed generation must not count toward the thread cap or hold the lock for ever.
  await recoverStaleTurn(db, { auth })
  const thread = await requireThread(db, auth, threadId)
  await assertWithinBudget(db, auth, config.aiDailyTokenBudget)
  if (thread.messageCount + 2 > MAX_THREAD_MESSAGES) {
    throw conflict('thread_full', 'This thread is full. Start a new thread to keep asking.')
  }
  const topic = await requireTopic(db, thread.topicId)
  const lockToken = await acquireGenerationLock(db, auth)
  try {
    const history = await buildHistory(db, auth, thread.id)
    const ids = await db.transaction().execute(async (trx) => {
      const user = await trx
        .insertInto('message')
        .values({
          thread_id: thread.id,
          user_id: auth.userId,
          role: 'user',
          content,
          status: 'complete',
          stop_reason: null
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      const assistant = await trx
        .insertInto('message')
        .values({
          thread_id: thread.id,
          user_id: auth.userId,
          role: 'assistant',
          content: '',
          status: 'incomplete',
          stop_reason: null
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      const retitle = thread.messageCount === 0 && thread.title === DEFAULT_TITLE
      const title = retitle ? titleFrom(content) : ''
      await trx
        .updateTable('thread')
        .set({
          updated_at: sql<Date>`now()`,
          ...(title !== '' ? { title } : {})
        })
        .where('id', '=', thread.id)
        .where(ownedBy('thread', auth))
        .execute()
      return { userMessageId: user.id, assistantMessageId: assistant.id }
    })
    return { threadId: thread.id, ...ids, lockToken, topicName: topic.name, history }
  } catch (err) {
    await releaseGenerationLock(db, auth, lockToken)
    throw err
  }
}

/**
 * Persists the outcome of the provider call and ALWAYS releases the generation lock. Call it once
 * the provider finished or failed, whatever happened before.
 *
 * | outcome                 | assistant                          | user message |
 * | end_turn/stop_sequence  | text / complete / reason           | complete     |
 * | max_tokens              | text / incomplete / max_tokens     | complete     |
 * | aborted                 | partial / incomplete / aborted     | complete     |
 * | refusal                 | '' / failed / refusal              | failed       |
 * | provider error          | '' / failed / error                | failed       |
 *
 * The `ai_call` ledger row and the message persistence are independent writes: a persistence
 * failure never loses the spend, and a ledger failure never loses the answer. The messages and
 * the lock release share one transaction, so the state is atomic. If that transaction fails, a
 * fallback marks the turn `failed`, the lock is released defensively, and the error is rethrown.
 */
export async function finishAsk(
  db: Db,
  auth: Auth,
  ctx: Pick<AskContext, 'userMessageId' | 'assistantMessageId' | 'lockToken'>,
  outcome: AskOutcome,
  log: Pick<Logger, 'error'>
): Promise<void> {
  const result = outcome.kind === 'result' ? outcome.result : undefined
  const stopReason = result ? result.stopReason : 'error'
  const failed = stopReason === 'refusal' || stopReason === 'error'
  const incomplete = stopReason === 'max_tokens' || stopReason === 'aborted'
  const status = failed ? 'failed' : incomplete ? 'incomplete' : 'complete'
  const usage =
    result?.usage ?? (outcome.kind === 'error' ? outcome.usage : undefined) ?? ZERO_USAGE
  try {
    try {
      await recordAiCall(db, auth, {
        kind: 'explain',
        model: outcome.kind === 'result' ? outcome.result.model : outcome.model,
        input_token: usage.inputTokens,
        output_token: usage.outputTokens,
        cache_read_token: usage.cacheReadTokens,
        cache_creation_token: usage.cacheCreationTokens,
        stop_reason: stopReason,
        refusal_category: result?.refusalCategory ?? null,
        latency_ms: Math.max(0, Math.round(outcome.latencyMs))
      })
    } catch (err) {
      log.error({ err, userMessageId: ctx.userMessageId }, 'recording the ai_call failed')
    }
    try {
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('message')
          .set({ content: failed ? '' : (result?.text ?? ''), status, stop_reason: stopReason })
          .where('id', '=', ctx.assistantMessageId)
          .where(ownedBy('message', auth))
          .execute()
        if (failed) {
          await trx
            .updateTable('message')
            .set({ status: 'failed' })
            .where('id', '=', ctx.userMessageId)
            .where(ownedBy('message', auth))
            .execute()
        }
        await releaseGenerationLock(trx, auth, ctx.lockToken)
      })
    } catch (err) {
      log.error({ err, userMessageId: ctx.userMessageId }, 'persisting the outcome failed')
      await markTurnFailed(db, auth, ctx, log)
      throw err
    }
  } finally {
    // Covers every path where the transaction did not commit; a no-op after it did.
    await releaseGenerationLock(db, auth, ctx.lockToken)
  }
}

/** Fallback after a persistence failure: never leave the turn looking in flight. */
async function markTurnFailed(
  db: Db,
  auth: Auth,
  ctx: Pick<AskContext, 'userMessageId' | 'assistantMessageId'>,
  log: Pick<Logger, 'error'>
): Promise<void> {
  try {
    await db
      .updateTable('message')
      .set({ content: '', status: 'failed', stop_reason: 'error' })
      .where('id', '=', ctx.assistantMessageId)
      .where(ownedBy('message', auth))
      .execute()
    await db
      .updateTable('message')
      .set({ status: 'failed', stop_reason: 'error' })
      .where('id', '=', ctx.userMessageId)
      .where(ownedBy('message', auth))
      .execute()
  } catch (err) {
    log.error({ err, userMessageId: ctx.userMessageId }, 'marking the turn failed also failed')
  }
}
