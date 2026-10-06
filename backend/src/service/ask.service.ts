import { sql } from 'kysely'
import type { Config } from '../lib/config.js'
import type { Db } from '../lib/db/index.js'
import { conflict } from '../lib/error.js'
import type { ExplainResult, TutorTurn } from '../lib/tutor/tutor.js'
import { ZERO_USAGE } from '../lib/tutor/tutor.js'
import { assertAiEnabled } from './ai-guard.js'
import { assertWithinBudget, recordAiCall } from './ai-budget.js'
import { acquireGenerationLock, releaseGenerationLock } from './generation-lock.js'
import { ownedBy, type Auth } from './ownership.js'
import { DEFAULT_TITLE, requireThread } from './thread.service.js'
import { requireTopic } from './topic.service.js'

/** A thread holds at most 25 non-failed messages (ledger ruling 14). */
export const MAX_THREAD_MESSAGES = 25
const MAX_TITLE_CHARS = 80

export type AskContext = {
  threadId: string
  userMessageId: string
  assistantMessageId: string
  topicName: string
  history: TutorTurn[]
}

export type AskOutcome =
  | { kind: 'result'; result: ExplainResult; latencyMs: number }
  | { kind: 'error'; model: string; latencyMs: number }

function titleFrom(content: string): string {
  const firstLine = content.trim().split(/\r?\n/)[0] ?? ''
  return firstLine.trim().slice(0, MAX_TITLE_CHARS)
}

/**
 * Earlier turns, oldest first, as the model should see them. Failed turns are left out (on
 * failure both messages of the turn are `failed`), and so are assistant messages with no text.
 * `incomplete` answers are sent as they are.
 */
async function buildHistory(db: Db, auth: Auth, threadId: string): Promise<TutorTurn[]> {
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
  const thread = await requireThread(db, auth, threadId)
  await assertWithinBudget(db, auth, config.aiDailyTokenBudget)
  if (thread.messageCount + 2 > MAX_THREAD_MESSAGES) {
    throw conflict('thread_full', 'This thread is full. Start a new thread to keep asking.')
  }
  const topic = await requireTopic(db, thread.topicId)
  await acquireGenerationLock(db, auth)
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
    return { threadId: thread.id, ...ids, topicName: topic.name, history }
  } catch (err) {
    await releaseGenerationLock(db, auth)
    throw err
  }
}

/**
 * Persists the outcome of the provider call and ALWAYS releases the generation lock, even when
 * persisting fails. Call it from a `finally`.
 *
 * | outcome                 | assistant                          | user message |
 * | end_turn/stop_sequence  | text / complete / reason           | complete     |
 * | max_tokens              | text / incomplete / max_tokens     | complete     |
 * | aborted                 | partial / incomplete / aborted     | complete     |
 * | refusal                 | '' / failed / refusal              | failed       |
 * | provider error          | '' / failed / error                | failed       |
 */
export async function finishAsk(
  db: Db,
  auth: Auth,
  ctx: Pick<AskContext, 'userMessageId' | 'assistantMessageId'>,
  outcome: AskOutcome
): Promise<void> {
  const result = outcome.kind === 'result' ? outcome.result : undefined
  const stopReason = result ? result.stopReason : 'error'
  const failed = stopReason === 'refusal' || stopReason === 'error'
  const incomplete = stopReason === 'max_tokens' || stopReason === 'aborted'
  const status = failed ? 'failed' : incomplete ? 'incomplete' : 'complete'
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
      const usage = result?.usage ?? ZERO_USAGE
      await recordAiCall(trx, auth, {
        kind: 'explain',
        model: result?.model ?? (outcome.kind === 'error' ? outcome.model : 'unknown'),
        input_token: usage.inputTokens,
        output_token: usage.outputTokens,
        cache_read_token: usage.cacheReadTokens,
        stop_reason: stopReason,
        refusal_category: result?.refusalCategory ?? null,
        latency_ms: Math.max(0, Math.round(outcome.latencyMs))
      })
    })
  } finally {
    await releaseGenerationLock(db, auth)
  }
}
