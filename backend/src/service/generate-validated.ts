import type { z } from 'zod'
import type { Db } from '../lib/db/index.js'
import { badGateway, unprocessable } from '../lib/error.js'
import type { Logger } from '../lib/logger.js'
import { ZERO_USAGE, type StructuredResult } from '../lib/tutor/tutor.js'
import { recordAiCall } from './ai-budget.js'
import type { Auth } from './ownership.js'

/** One attempt plus one retry when the output is unusable. */
export const MAX_ATTEMPTS = 2

export type GenerationKind = 'guide' | 'quiz'

type RecordedCall = {
  model: string
  stopReason: string
  refusalCategory: string | null
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number }
  latencyMs: number
}

/**
 * Runs a structured-output provider call and validates the result with `schema`. Shared by guide
 * and quiz generation. Every provider call is recorded in `ai_call` (kind `kind`), independently
 * of any persistence transaction. Unusable output (a truncation or a draft that fails the schema)
 * is retried once, then 502 `ai_invalid_output`; a refusal is 422 `ai_refused` and a provider
 * error is 502 `ai_provider_error`, neither retried (the SDK already retries transient errors).
 *
 * The caller owns the generation lock and releases it in a `finally`.
 */
export async function generateValidated<S extends z.ZodType>(
  db: Db,
  auth: Auth,
  options: {
    kind: GenerationKind
    schema: S
    /** One provider call. */
    call: () => Promise<StructuredResult>
    /** Recorded for a call that threw before returning a result. */
    model: string
    logger: Pick<Logger, 'error'>
    /** Extra log fields (ids only, never content). */
    logContext?: Record<string, string>
  }
): Promise<z.output<S>> {
  const { kind, schema, call, model, logger } = options
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now()
    let result: StructuredResult
    try {
      result = await call()
    } catch (err) {
      // Never log the conversation or the model output, only the failure.
      logger.error({ err, ...options.logContext }, `${kind} generation failed`)
      await recordCall(db, auth, logger, kind, {
        model,
        stopReason: 'error',
        refusalCategory: null,
        usage: ZERO_USAGE,
        latencyMs: Date.now() - startedAt
      })
      throw badGateway('ai_provider_error', 'The AI service failed to answer. Retry in a moment.')
    }
    await recordCall(db, auth, logger, kind, {
      model: result.model,
      stopReason: result.stopReason,
      refusalCategory: result.refusalCategory,
      usage: result.usage,
      latencyMs: Date.now() - startedAt
    })
    if (result.stopReason === 'refusal') {
      throw unprocessable('ai_refused', "The tutor can't help with that. Try rephrasing it.")
    }
    const parsed = schema.safeParse(result.output)
    if (parsed.success) return parsed.data
  }
  throw badGateway('ai_invalid_output', `The tutor produced an unusable ${kind}. Try again.`)
}

async function recordCall(
  db: Db,
  auth: Auth,
  logger: Pick<Logger, 'error'>,
  kind: GenerationKind,
  call: RecordedCall
): Promise<void> {
  try {
    await recordAiCall(db, auth, {
      kind,
      model: call.model,
      input_token: call.usage.inputTokens,
      output_token: call.usage.outputTokens,
      cache_read_token: call.usage.cacheReadTokens,
      stop_reason: call.stopReason,
      refusal_category: call.refusalCategory,
      latency_ms: Math.max(0, Math.round(call.latencyMs))
    })
  } catch (err) {
    logger.error({ err }, 'recording the ai_call failed')
  }
}
