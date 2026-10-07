import { Router, type Response } from 'express'
import type { Config } from '../../lib/config.js'
import type { Db } from '../../lib/db/index.js'
import type { InFlightRegistry } from '../../lib/in-flight.js'
import type { Logger } from '../../lib/logger.js'
import { TutorProviderError, type TutorProvider } from '../../lib/tutor/tutor.js'
import { assertAiEnabled } from '../ai/index.js'
import { finishAsk, startAsk, type AskOutcome } from './message.service.js'
import { getAuth } from '../../http/get-auth.js'
import { pathId } from '../../http/path-id.js'
import { requireSession } from '../user/index.js'
import { askSchema } from './message.schema.js'

const HEARTBEAT_MS = 15_000
const REFUSED_MESSAGE = "The tutor can't help with that question. Try rephrasing it."
const PROVIDER_ERROR_MESSAGE = 'The AI service failed to answer. Retry in a moment.'
const INTERNAL_MESSAGE = 'Something went wrong on our side. Try again.'

/** Writes SSE frames, silently dropping them once the response is finished or gone. */
function eventWriter(res: Response) {
  const alive = () => !res.writableEnded && !res.destroyed
  return {
    event(name: string, data: unknown) {
      if (alive()) res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    },
    comment(text: string) {
      if (alive()) res.write(`: ${text}\n\n`)
    }
  }
}

export function messageRouter(
  db: Db,
  config: Config,
  tutor: TutorProvider,
  logger: Pick<Logger, 'error'>,
  inFlight: InFlightRegistry
): Router {
  const router = Router()

  router.post('/api/thread/:id/message', requireSession(db, config), async (req, res) => {
    // The AI switch is the first check, before the body is looked at (same order as the quiz).
    assertAiEnabled(config)
    const auth = getAuth(req)
    const { content } = askSchema.parse(req.body)
    // Any AppError here is a normal JSON error response: no SSE headers have been sent yet.
    const ctx = await startAsk(db, auth, config, pathId(req), content)
    const requestId = String(res.locals.requestId)
    const out = eventWriter(res)
    const controller = new AbortController()
    const errorEvent = (code: string, message: string) =>
      out.event('error', { error: { code, message }, requestId })
    const startedAt = Date.now()
    let heartbeat: NodeJS.Timeout | undefined
    // Shutdown aborts this controller; the normal path below then persists `aborted` and releases
    // the lock through `finishAsk`. Nothing else may persist or release.
    const untrack = inFlight.track(controller)
    let outcome: AskOutcome

    // From here on the generation lock is held: every path, including a synchronous throw while
    // setting up the stream, must reach `finishAsk` (which releases it) and clear the heartbeat.
    try {
      res.status(200)
      res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      })
      res.flushHeaders()
      // A close before the response finished means the client went away.
      res.on('close', () => {
        if (!res.writableFinished) controller.abort()
      })
      // The client may already be gone after the database work above: do not generate for nobody.
      if (res.destroyed || res.socket?.destroyed) controller.abort()
      heartbeat = setInterval(() => out.comment('ping'), HEARTBEAT_MS)
      out.event('message.start', {
        threadId: ctx.threadId,
        userMessageId: ctx.userMessageId,
        assistantMessageId: ctx.assistantMessageId
      })
      const result = await tutor.explain(
        {
          topicName: ctx.topicName,
          history: ctx.history,
          question: content,
          signal: controller.signal
        },
        (text) => out.event('delta', { text })
      )
      outcome = { kind: 'result', result, latencyMs: Date.now() - startedAt }
    } catch (err) {
      // Log the failure, never the question or answer text.
      logger.error({ err, requestId, threadId: ctx.threadId }, 'tutor provider failed')
      outcome = {
        kind: 'error',
        model: tutor.model,
        latencyMs: Date.now() - startedAt,
        ...(err instanceof TutorProviderError && err.usage ? { usage: err.usage } : {})
      }
    }

    try {
      await finishAsk(db, auth, ctx, outcome, logger)
      if (outcome.kind === 'error') {
        errorEvent('ai_provider_error', PROVIDER_ERROR_MESSAGE)
      } else if (outcome.result.stopReason === 'refusal') {
        errorEvent('ai_refused', REFUSED_MESSAGE)
      } else if (outcome.result.stopReason !== 'aborted') {
        const { stopReason, usage } = outcome.result
        out.event('message.complete', {
          messageId: ctx.assistantMessageId,
          status: stopReason === 'max_tokens' ? 'incomplete' : 'complete',
          stopReason,
          // The contract declares three fields; cache creation is ledger-only.
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens
          }
        })
      }
    } catch (err) {
      logger.error({ err, requestId, threadId: ctx.threadId }, 'persisting the answer failed')
      errorEvent('internal_error', INTERNAL_MESSAGE)
    } finally {
      untrack()
      clearInterval(heartbeat)
      if (!res.writableEnded) res.end()
    }
  })

  return router
}
