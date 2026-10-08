import { sql } from 'kysely'
import type { Db } from '../../lib/db/index.js'
import type { MessageStatus, MessageStopReason } from '../../lib/db/schema.js'
import { conflict } from '../../lib/error.js'
import type { Logger } from '../../lib/logger.js'
import { startTimer } from '../../lib/time.js'
import type { ExplainResult, TutorProvider, TutorTurn, TutorUsage } from '../../lib/tutor/tutor.js'
import { TutorProviderError, ZERO_USAGE } from '../../lib/tutor/tutor.js'
import type { AiApi, GenerationLockToken } from '../../services/ai/index.js'
import { ownedBy, type Auth } from '../../lib/ownership.js'
import { DEFAULT_TITLE, type ThreadService } from './service.js'
import { olderThanTtl, recoverStaleTurn } from './stale-turn.js'
import type { TopicApi } from '../topic/index.js'

/** A thread holds at most 25 non-failed messages (ledger ruling 14). */
const MAX_THREAD_MESSAGES = 25
const MAX_TITLE_CHARS = 80

type AskContext = {
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
 * The status of a turn's assistant message, by its stop reason (`error` = the provider call
 * failed). Keyed by every stop reason, so a new one does not compile until it is placed here.
 */
export const STATUS_BY_STOP_REASON: Record<MessageStopReason, MessageStatus> = {
  end_turn: 'complete',
  stop_sequence: 'complete',
  max_tokens: 'incomplete',
  aborted: 'incomplete',
  refusal: 'failed',
  error: 'failed'
}

type ExplainOptions = {
  signal: AbortSignal
  /** Receives each chunk of the answer as it streams. */
  onDelta: (text: string) => void
  /** Ids for the failure log line, never content. */
  logContext: { requestId: string }
}

/**
 * The thread title: the first non-empty line that is not a code fence, whitespace collapsed.
 * Over 80 characters it is cut at the last word boundary within 79 characters and gets an
 * ellipsis (a single long word is cut hard). The default title when no such line exists.
 */
function titleFrom(content: string): string {
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

type MessageServiceDeps = {
  db: Db
  tutor: TutorProvider
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
   * Calls the provider and streams the answer through `onDelta`. Never throws for a provider
   * failure: it logs it (never the question or answer text) and returns an `error` outcome that
   * keeps the usage the provider observed before failing. Pass the outcome to `finish`.
   */
  explain(
    ctx: Pick<AskContext, 'threadId' | 'topicName' | 'history'>,
    content: string,
    options: ExplainOptions
  ): Promise<AskOutcome>
  /**
   * The `error` outcome of a turn whose provider call failed, or never ran (`latencyMs` 0): it is
   * recorded against the tutor's model, with the usage a `TutorProviderError` observed before
   * failing.
   */
  failedOutcome(err: unknown, latencyMs?: number): AskOutcome
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
}

export function createMessageService({
  db,
  tutor,
  topic: topicApi,
  ai,
  thread: threadService,
  logger
}: MessageServiceDeps): MessageService {
  const failedOutcome = (err: unknown, latencyMs = 0): AskOutcome => ({
    kind: 'error',
    model: tutor.model,
    latencyMs,
    ...(err instanceof TutorProviderError && err.usage ? { usage: err.usage } : {})
  })

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
        const history = await threadService.history(auth, thread.id)
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
          const shouldRetitle = thread.messageCount === 0 && thread.title === DEFAULT_TITLE
          const title = shouldRetitle ? titleFrom(content) : ''
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
    async explain(ctx, content, { signal, onDelta, logContext }) {
      const elapsedMs = startTimer()
      try {
        const result = await tutor.explain(
          { topicName: ctx.topicName, history: ctx.history, question: content, signal },
          onDelta
        )
        return { kind: 'result', result, latencyMs: elapsedMs() }
      } catch (err) {
        // Log the failure, never the question or answer text.
        logger.error({ ...logContext, err, threadId: ctx.threadId }, 'tutor provider failed')
        return failedOutcome(err, elapsedMs())
      }
    },
    failedOutcome,
    async finish(auth, ctx, outcome) {
      const result = outcome.kind === 'result' ? outcome.result : undefined
      const stopReason = result ? result.stopReason : 'error'
      const status = STATUS_BY_STOP_REASON[stopReason]
      const isFailed = status === 'failed'
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
              .set({
                content: isFailed ? '' : (result?.text ?? ''),
                status,
                stop_reason: stopReason
              })
              .where('id', '=', ctx.assistantMessageId)
              .where('stop_reason', 'is', null)
              .where(ownedBy('message', auth))
              .executeTakeFirst()
            if (updated.numUpdatedRows === 0n) {
              logger.warn(
                { userMessageId: ctx.userMessageId },
                'the turn was recovered before it finished; keeping the recovered state'
              )
            } else if (isFailed) {
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
    }
  }
}
