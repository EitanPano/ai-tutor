import { sql } from 'kysely'
import type { Db } from '../../lib/db/index.js'
import { conflict } from '../../lib/error.js'
import type { Logger } from '../../lib/logger.js'
import type { ExplainResult, TutorTurn, TutorUsage } from '../../lib/tutor/tutor.js'
import { capHistory, ZERO_USAGE } from '../../lib/tutor/tutor.js'
import type { AiApi, GenerationLockToken } from '../../services/ai/index.js'
import { ownedBy, type Auth } from '../../lib/ownership.js'
import { DEFAULT_TITLE, type ThreadService } from './thread.service.js'
import { olderThanTtl, recoverStaleTurn } from './stale-turn.js'
import type { TopicApi } from '../topic/index.js'

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
  return capHistory(rows.filter((row) => row.role === 'user' || row.content !== ''))
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

export type MessageServiceDeps = {
  db: Db
  topic: TopicApi
  ai: AiApi
  thread: ThreadService
  logger: Pick<Logger, 'error' | 'warn'>
}

export type MessageService = {
  /**
   * Validates everything that can reject the request, takes the generation lock and persists the
   * user message plus an `incomplete` assistant placeholder. Throws an AppError on any rejection
   * (the lock is only held when this returns). The caller MUST call `finish` afterwards.
   */
  start(auth: Auth, threadId: string, content: string): Promise<AskContext>
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
  finish(
    auth: Auth,
    ctx: Pick<AskContext, 'userMessageId' | 'assistantMessageId' | 'lockToken'>,
    outcome: AskOutcome
  ): Promise<void>
  /**
   * Earlier turns, oldest first, as the model should see them. Failed turns are left out (on
   * failure both messages of the turn are `failed`), and so are assistant messages with no text.
   * `incomplete` answers are sent as they are.
   */
  history(auth: Auth, threadId: string): Promise<TutorTurn[]>
}

export function createMessageService({
  db,
  topic: topicApi,
  ai,
  thread: threadService,
  logger
}: MessageServiceDeps): MessageService {
  return {
    async start(auth, threadId, content) {
      // Backstop; the route checks first so the error order stays kill switch → body.
      ai.assertEnabled()
      // A crashed generation must not count toward the thread cap or hold the lock for ever.
      await recoverStaleTurn(db, olderThanTtl(ai.lockTtlSeconds), { auth })
      const thread = await threadService.require(auth, threadId)
      await ai.assertWithinBudget(auth)
      if (thread.messageCount + 2 > MAX_THREAD_MESSAGES) {
        throw conflict('thread_full', 'This thread is full. Start a new thread to keep asking.')
      }
      const topic = await topicApi.require(thread.topicId)
      const lockToken = await ai.acquireLock(auth)
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
        await ai.releaseLock(auth, lockToken)
        throw err
      }
    },
    async finish(auth, ctx, outcome) {
      const result = outcome.kind === 'result' ? outcome.result : undefined
      const stopReason = result ? result.stopReason : 'error'
      const failed = stopReason === 'refusal' || stopReason === 'error'
      const incomplete = stopReason === 'max_tokens' || stopReason === 'aborted'
      const status = failed ? 'failed' : incomplete ? 'incomplete' : 'complete'
      const usage =
        result?.usage ?? (outcome.kind === 'error' ? outcome.usage : undefined) ?? ZERO_USAGE
      try {
        try {
          await ai.recordCall(auth, {
            kind: 'explain',
            model: outcome.kind === 'result' ? outcome.result.model : outcome.model,
            usage,
            stopReason,
            refusalCategory: result?.refusalCategory ?? null,
            latencyMs: outcome.latencyMs
          })
        } catch (err) {
          logger.error({ err, userMessageId: ctx.userMessageId }, 'recording the ai_call failed')
        }
        try {
          await db.transaction().execute(async (trx) => {
            // `stop_reason IS NULL` = the placeholder is still in flight. A turn that lazy recovery
            // already failed (this stream outlived the lock TTL) must not be overwritten.
            const updated = await trx
              .updateTable('message')
              .set({ content: failed ? '' : (result?.text ?? ''), status, stop_reason: stopReason })
              .where('id', '=', ctx.assistantMessageId)
              .where('stop_reason', 'is', null)
              .where(ownedBy('message', auth))
              .executeTakeFirst()
            if (updated.numUpdatedRows === 0n) {
              logger.warn(
                { userMessageId: ctx.userMessageId },
                'the turn was recovered before it finished; keeping the recovered state'
              )
            } else if (failed) {
              await trx
                .updateTable('message')
                .set({ status: 'failed' })
                .where('id', '=', ctx.userMessageId)
                .where(ownedBy('message', auth))
                .execute()
            }
            await ai.releaseLock(auth, ctx.lockToken, trx)
          })
        } catch (err) {
          logger.error({ err, userMessageId: ctx.userMessageId }, 'persisting the outcome failed')
          await markTurnFailed(db, auth, ctx, logger)
          throw err
        }
      } finally {
        // Covers every path where the transaction did not commit; a no-op after it did.
        await ai.releaseLock(auth, ctx.lockToken)
      }
    },
    history: (auth, threadId) => buildHistory(db, auth, threadId)
  }
}
