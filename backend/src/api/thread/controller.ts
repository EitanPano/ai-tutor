import { ctxOf, servicesOf } from '../../context.js'
import { ERROR_MESSAGE } from '../../lib/error.js'
import { openEventStream, type EventStream } from '../../lib/sse.js'
import type { ExplainResult, TutorStopReason } from '../../lib/tutor/tutor.js'
import type { IdParams } from '../../lib/validation.js'
import { getAuth } from '../../middleware/auth.js'
import type { Handler, ParamsDictionary } from '../../middleware/validate.js'
import { STATUS_BY_STOP_REASON, type AskOutcome } from './message.service.js'
import type { AskBody, CreateBody, ListQuery, UpdateBody } from './validation.js'

const HEARTBEAT_MS = 15_000

/** The user's live threads, most recently updated first: `{ threads, nextCursor }`. */
export const list: Handler<ParamsDictionary, unknown, ListQuery> = async (req, res) => {
  res.json(await servicesOf(req).thread.list(getAuth(req), req.query))
}

/** Creates a thread (topic `other` and the default title unless given): 201 `{ thread }`. */
export const create: Handler<ParamsDictionary, CreateBody> = async (req, res) => {
  const thread = await servicesOf(req).thread.create(getAuth(req), req.body)
  res.status(201).json({ thread })
}

/** The thread with its messages, guides and quizzes: `{ thread, messages, guides, quizzes }`. */
export const get: Handler<IdParams> = async (req, res) => {
  res.json(await servicesOf(req).thread.getDetail(getAuth(req), req.params.id))
}

/** Renames the thread and/or moves it to another topic: `{ thread }`. */
export const update: Handler<IdParams, UpdateBody> = async (req, res) => {
  const thread = await servicesOf(req).thread.update(getAuth(req), req.params.id, req.body)
  res.json({ thread })
}

/** Soft-deletes the thread: 204. */
export const remove: Handler<IdParams> = async (req, res) => {
  await servicesOf(req).thread.delete(getAuth(req), req.params.id)
  res.status(204).end()
}

type SseEvent = { name: string; data: unknown }
type Answered = { messageId: string; result: ExplainResult; requestId: string }

const errorEvent = (code: keyof typeof ERROR_MESSAGE, requestId: string): SseEvent => ({
  name: 'error',
  data: { error: { code, message: ERROR_MESSAGE[code] }, requestId }
})

const completeEvent = ({ messageId, result }: Answered): SseEvent => ({
  name: 'message.complete',
  data: {
    messageId,
    status: STATUS_BY_STOP_REASON[result.stopReason],
    stopReason: result.stopReason,
    // The contract declares three fields; cache creation is ledger-only.
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens
    }
  }
})

/** How an answered turn ends the stream, by stop reason; `undefined` sends nothing. */
const END_BY_STOP_REASON: Record<TutorStopReason, (answered: Answered) => SseEvent | undefined> = {
  end_turn: completeEvent,
  stop_sequence: completeEvent,
  max_tokens: completeEvent,
  refusal: ({ requestId }) => errorEvent('ai_refused', requestId),
  // The client left, or the server is shutting down: the stream just ends.
  aborted: () => undefined
}

/** The stream's last event: a provider failure, else the answered turn's ending. */
function endEvent(messageId: string, outcome: AskOutcome, requestId: string): SseEvent | undefined {
  return outcome.kind === 'error'
    ? errorEvent('ai_provider_error', requestId)
    : END_BY_STOP_REASON[outcome.result.stopReason]({
        messageId,
        result: outcome.result,
        requestId
      })
}

/**
 * Asks the tutor and streams the answer as SSE: `message.start`, `delta`s, then
 * `message.complete` or an `error` event.
 */
export const ask: Handler<IdParams, AskBody> = async (req, res) => {
  const { inFlight, logger } = ctxOf(req)
  const { message } = servicesOf(req)
  const auth = getAuth(req)
  const { content } = req.body
  // Any AppError here is a normal JSON error response: no SSE headers have been sent yet.
  const ctx = await message.start(auth, req.params.id, content)
  const requestId = String(res.locals.requestId)
  const controller = new AbortController()
  // Shutdown aborts this controller; the normal path below then persists `aborted` and releases
  // the lock through `message.finish`. Nothing else may persist or release.
  const untrack = inFlight.track(controller)
  let stream: EventStream | undefined
  let outcome: AskOutcome

  // From here on the generation lock is held: every path, including a synchronous throw while
  // opening the stream, must reach `message.finish` (which releases it) and close the stream.
  try {
    stream = openEventStream(res, {
      heartbeatMs: HEARTBEAT_MS,
      // The client left, or was already gone after the database work in `start`: do not
      // generate for nobody.
      onClientGone: () => controller.abort()
    })
    stream.event('message.start', {
      threadId: ctx.threadId,
      userMessageId: ctx.userMessageId,
      assistantMessageId: ctx.assistantMessageId
    })
    // Never throws for a provider failure: that comes back as an `error` outcome.
    outcome = await message.explain(ctx, content, {
      signal: controller.signal,
      onDelta: (text) => stream?.event('delta', { text }),
      logContext: { requestId }
    })
  } catch (err) {
    // `explain` returns provider failures as an outcome, so whatever lands here failed outside
    // the provider call (in practice, opening the stream). The turn still goes through `finish`
    // as a failed call, which fails it and releases the lock.
    logger.error({ err, requestId, threadId: ctx.threadId }, 'streaming the answer failed')
    outcome = message.failedOutcome(err)
  }

  try {
    await message.finish(auth, ctx, outcome)
    const end = endEvent(ctx.assistantMessageId, outcome, requestId)
    if (end) stream?.event(end.name, end.data)
  } catch (err) {
    logger.error({ err, requestId, threadId: ctx.threadId }, 'persisting the answer failed')
    const failure = errorEvent('internal_error', requestId)
    stream?.event(failure.name, failure.data)
  } finally {
    untrack()
    // Stops the heartbeat and ends the response (already ended when opening the stream threw).
    stream?.close()
  }
}
