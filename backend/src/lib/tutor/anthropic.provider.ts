import Anthropic from '@anthropic-ai/sdk'
import { EXPLAIN_SYSTEM_PROMPT_V1 } from './prompt/explain.v1.js'
import {
  buildMessages,
  TutorProviderError,
  ZERO_USAGE,
  type ExplainInput,
  type ExplainResult,
  type TutorProvider,
  type TutorStopReason,
  type TutorUsage
} from './tutor.js'

export const MAX_OUTPUT_TOKENS = 2048

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
}): TutorUsage {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0
  }
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
    maxRetries: options.maxRetries ?? 2,
    timeout: 60_000,
    ...(options.fetch ? { fetch: options.fetch } : {})
  })
  const model = options.model

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
          return { text, stopReason: 'aborted', refusalCategory: null, usage: seenUsage, model }
        }
        // Never leak the raw provider payload: callers only see a generic error.
        throw new TutorProviderError('The AI provider failed.', { cause: err })
      }
    }
  }
}
