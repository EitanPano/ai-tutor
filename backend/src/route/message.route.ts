import { Router, type Response } from 'express'
import { z } from 'zod'
import type { Config } from '../lib/config.js'
import type { Db } from '../lib/db/index.js'
import type { Logger } from '../lib/logger.js'
import type { TutorProvider } from '../lib/tutor/tutor.js'
import { finishAsk, startAsk, type AskOutcome } from '../service/ask.service.js'
import { getAuth } from './middleware/get-auth.js'
import { pathId } from './middleware/path-id.js'
import { requireSession } from './middleware/require-session.js'

const HEARTBEAT_MS = 15_000
const REFUSED_MESSAGE = "The tutor can't help with that question. Try rephrasing it."
const PROVIDER_ERROR_MESSAGE = 'The AI service failed to answer. Retry in a moment.'
const INTERNAL_MESSAGE = 'Something went wrong on our side. Try again.'

// Mirrors AskRequest in .orchestrate/api-contract.yaml; whitespace-only counts as empty.
const askSchema = z.strictObject({
  content: z
    .string()
    .max(20_000)
    .refine((value) => value.trim().length > 0, {
      message: 'Too small: expected at least 1 character'
    })
})

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
  logger: Pick<Logger, 'error'>
): Router {
  const router = Router()

  router.post('/api/thread/:id/message', requireSession(db, config), async (req, res) => {
    const auth = getAuth(req)
    const { content } = askSchema.parse(req.body)
    // Any AppError here is a normal JSON error response: no SSE headers have been sent yet.
    const ctx = await startAsk(db, auth, config, pathId(req), content)
    const requestId = String(res.locals.requestId)

    res.status(200)
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    res.flushHeaders()

    const out = eventWriter(res)
    const controller = new AbortController()
    // A close before the response finished means the client went away.
    res.on('close', () => {
      if (!res.writableFinished) controller.abort()
    })
    const heartbeat = setInterval(() => out.comment('ping'), HEARTBEAT_MS)
    const errorEvent = (code: string, message: string) =>
      out.event('error', { error: { code, message }, requestId })

    out.event('message.start', {
      threadId: ctx.threadId,
      userMessageId: ctx.userMessageId,
      assistantMessageId: ctx.assistantMessageId
    })

    const startedAt = Date.now()
    const modelName = config.aiProvider === 'fake' ? 'fake' : config.aiModel
    let outcome: AskOutcome
    try {
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
      outcome = { kind: 'error', model: modelName, latencyMs: Date.now() - startedAt }
    }

    try {
      await finishAsk(db, auth, ctx, outcome)
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
          usage
        })
      }
    } catch (err) {
      logger.error({ err, requestId, threadId: ctx.threadId }, 'persisting the answer failed')
      errorEvent('internal_error', INTERNAL_MESSAGE)
    } finally {
      clearInterval(heartbeat)
      if (!res.writableEnded) res.end()
    }
  })

  return router
}
