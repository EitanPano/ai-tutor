import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'
import { GuideDraftSchema } from './guide.schema.js'
import { GUIDE_SYSTEM_PROMPT_V1 } from './prompt/guide.v1.js'
import { QUIZ_SYSTEM_PROMPT_V1 } from './prompt/quiz.v1.js'
import { QuizDraftSchema } from './quiz.schema.js'
import { EXPLAIN_SYSTEM_PROMPT_V1 } from './prompt/explain.v1.js'
import {
  buildMessages,
  estimateOutputTokens,
  TutorProviderError,
  ZERO_USAGE,
  type ExplainInput,
  type ExplainResult,
  type GuideInput,
  type QuizInput,
  type StructuredResult,
  type TutorProvider,
  type TutorStopReason,
  type TutorUsage
} from './tutor.js'

export const MAX_OUTPUT_TOKENS = 2048
export const MAX_STRUCTURED_OUTPUT_TOKENS = 4096
/** Per-attempt request timeout and default SDK retries; the generation lock TTL must outlast them. */
export const PROVIDER_TIMEOUT_MS = 60_000
export const PROVIDER_MAX_RETRIES = 2
const GUIDE_REQUEST = 'Write the step-by-step guide for this conversation.'

/** The final user turn of a quiz request. */
function quizRequest(input: QuizInput): string {
  const article = input.difficulty === 'easy' ? 'an' : 'a'
  return input.history === null
    ? `Write ${article} ${input.difficulty} quiz about ${input.topicName}.`
    : `Write ${article} ${input.difficulty} quiz on this conversation.`
}

export type AnthropicProviderOptions = {
  apiKey: string
  model: string
  /** SDK retries on transient errors (default 2). */
  maxRetries?: number
  /** Injectable for tests: the real SDK runs against canned SSE responses. */
  fetch?: typeof globalThis.fetch
}

function mapStopReason(reason: string | null): TutorStopReason {
  switch (reason) {
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'max_tokens'
    case 'stop_sequence':
    case 'refusal':
      return reason
    default:
      return 'end_turn'
  }
}

function toUsage(usage: {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}): TutorUsage {
  return {
    // Uncached input only: cache writes and reads are reported (and budgeted) separately.
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0
  }
}

/** Usage for an interrupted stream: `output_tokens` only arrives at `message_delta`. */
function partialUsage(seen: TutorUsage, text: string): TutorUsage {
  return { ...seen, outputTokens: Math.max(seen.outputTokens, estimateOutputTokens(text)) }
}

/** `stop_details` may be absent on Haiku 4.5, so it is read defensively. */
function refusalCategoryOf(message: object): string | null {
  const details = (message as { stop_details?: { category?: unknown } | null }).stop_details
  const category = details?.category
  return typeof category === 'string' ? category : null
}

export function createAnthropicProvider(options: AnthropicProviderOptions): TutorProvider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    maxRetries: options.maxRetries ?? PROVIDER_MAX_RETRIES,
    timeout: PROVIDER_TIMEOUT_MS,
    ...(options.fetch ? { fetch: options.fetch } : {})
  })
  const model = options.model

  /**
   * One non-streaming structured-output call. `messages.create` is used instead of
   * `messages.parse` on purpose: `parse` throws on a refusal, a truncation or a schema
   * mismatch, which would be indistinguishable from a provider failure. Here the model's text is
   * parsed leniently into `output` (or `null`) and the caller validates it. The Zod schema only
   * produces the JSON schema sent to the API. Reused by quiz generation.
   */
  async function structured(
    system: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    schema: z.ZodType
  ): Promise<StructuredResult> {
    try {
      // No `thinking`, `effort` or `temperature`: Haiku 4.5 rejects effort and runs without
      // thinking when it is omitted.
      const message = await client.messages.create({
        model,
        max_tokens: MAX_STRUCTURED_OUTPUT_TOKENS,
        system: [{ type: 'text', text: system }],
        cache_control: { type: 'ephemeral' },
        messages,
        output_config: { format: zodOutputFormat(schema) }
      })
      const stopReason = mapStopReason(message.stop_reason)
      let output: unknown = null
      // A refusal or a truncation carries no usable JSON.
      if (stopReason !== 'refusal' && stopReason !== 'max_tokens') {
        const text = message.content
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('')
        try {
          output = JSON.parse(text)
        } catch {
          output = null
        }
      }
      return {
        output,
        stopReason,
        refusalCategory: stopReason === 'refusal' ? refusalCategoryOf(message) : null,
        usage: toUsage(message.usage),
        model
      }
    } catch (err) {
      throw new TutorProviderError('The AI provider failed.', { cause: err })
    }
  }

  return {
    model,
    async explain(input: ExplainInput, onDelta): Promise<ExplainResult> {
      let text = ''
      let seenUsage: TutorUsage = ZERO_USAGE
      try {
        // No `thinking`, `output_config` or `temperature`: Haiku 4.5 runs without thinking when
        // it is omitted and rejects `effort`.
        const stream = client.messages.stream(
          {
            model,
            max_tokens: MAX_OUTPUT_TOKENS,
            system: [{ type: 'text', text: EXPLAIN_SYSTEM_PROMPT_V1 }],
            cache_control: { type: 'ephemeral' },
            messages: buildMessages(input)
          },
          { signal: input.signal }
        )
        stream.on('text', (delta) => {
          text += delta
          onDelta(delta)
        })
        stream.on('streamEvent', (_event, snapshot) => {
          seenUsage = toUsage(snapshot.usage)
        })
        const message = await stream.finalMessage()
        const stopReason = mapStopReason(message.stop_reason)
        return {
          text,
          stopReason,
          refusalCategory: stopReason === 'refusal' ? refusalCategoryOf(message) : null,
          usage: toUsage(message.usage),
          model
        }
      } catch (err) {
        if (err instanceof Anthropic.APIUserAbortError || input.signal.aborted) {
          return {
            text,
            stopReason: 'aborted',
            refusalCategory: null,
            usage: partialUsage(seenUsage, text),
            model
          }
        }
        // Never leak the raw provider payload: callers only see a generic error.
        throw new TutorProviderError('The AI provider failed.', {
          cause: err,
          usage: partialUsage(seenUsage, text)
        })
      }
    },
    generateGuide(input: GuideInput): Promise<StructuredResult> {
      return structured(
        GUIDE_SYSTEM_PROMPT_V1,
        buildMessages({ ...input, question: GUIDE_REQUEST }),
        GuideDraftSchema
      )
    },
    generateQuiz(input: QuizInput): Promise<StructuredResult> {
      return structured(
        QUIZ_SYSTEM_PROMPT_V1,
        buildMessages({
          topicName: input.topicName,
          history: input.history ?? [],
          question: quizRequest(input)
        }),
        QuizDraftSchema
      )
    }
  }
}
