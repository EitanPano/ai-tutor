export type TutorTurn = { role: 'user' | 'assistant'; content: string }
export type TutorStopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'refusal' | 'aborted'
export type TutorUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}
export type ExplainInput = {
  topicName: string
  history: TutorTurn[]
  question: string
  signal: AbortSignal
}
export type ExplainResult = {
  text: string
  stopReason: TutorStopReason
  refusalCategory: string | null
  usage: TutorUsage
  model: string
}

export type GuideInput = { topicName: string; history: TutorTurn[] }
export type QuizDifficultyName = 'easy' | 'medium' | 'hard'
/** `history` is `null` for a quiz generated from a topic alone. */
export type QuizInput = {
  topicName: string
  difficulty: QuizDifficultyName
  history: TutorTurn[] | null
}
/**
 * Result of a structured-output call. `output` is whatever the model returned (parsed JSON, or
 * `null` when it was missing, truncated or not JSON): validating it is the caller's job.
 */
export type StructuredResult = {
  output: unknown
  stopReason: TutorStopReason
  refusalCategory: string | null
  usage: TutorUsage
  model: string
}

export interface TutorProvider {
  /** Model name recorded in the `ai_call` ledger, including for failed calls. */
  readonly model: string
  /** Streams the answer through `onDelta` and resolves once the model stops. */
  explain(input: ExplainInput, onDelta: (text: string) => void): Promise<ExplainResult>
  /** One non-streaming call that returns a guide draft as structured output. */
  generateGuide(input: GuideInput): Promise<StructuredResult>
  /** One non-streaming call that returns a 5-item quiz draft as structured output. */
  generateQuiz(input: QuizInput): Promise<StructuredResult>
}

/** Upstream failure (network, 4xx/5xx from the API). The message never carries provider payloads. */
export class TutorProviderError extends Error {
  /** Usage observed before the failure (mid-stream), so the budget still counts it. */
  readonly usage: TutorUsage | undefined

  constructor(
    message = 'The AI provider failed.',
    options?: { cause?: unknown; usage?: TutorUsage }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'TutorProviderError'
    this.usage = options?.usage
  }
}

/** Rough output-token estimate for text that was streamed but never billed back to us. */
export function estimateOutputTokens(text: string): number {
  return Math.ceil(text.length / 3)
}

/** Rough input-token estimate (characters / 4) for a request that was sent but never reported usage. */
export function estimateInputTokens(
  system: string,
  messages: readonly { content: string }[]
): number {
  const chars = messages.reduce((sum, message) => sum + message.content.length, system.length)
  return Math.ceil(chars / 4)
}

/** Most history characters sent per call: about 16k tokens, so one request cannot dwarf the budget. */
export const HISTORY_CHAR_LIMIT = 64_000

/**
 * The newest turns whose total content fits in `HISTORY_CHAR_LIMIT`, oldest dropped first and
 * order kept. A leading assistant turn is dropped so the model never sees a reply with no question.
 */
export function capHistory(history: TutorTurn[]): TutorTurn[] {
  let total = 0
  let start = history.length
  while (start > 0) {
    const size = history[start - 1]!.content.length
    if (total + size > HISTORY_CHAR_LIMIT) break
    total += size
    start -= 1
  }
  while (start < history.length && history[start]!.role === 'assistant') start += 1
  return history.slice(start)
}

export const ZERO_USAGE: TutorUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0
}

/** What `buildMessages` lays out: an explain input without its abort signal. */
export type MessagesInput = Pick<ExplainInput, 'topicName' | 'history' | 'question'>

/**
 * The messages sent to the model: the thread history in order, then the new question. The first
 * user turn carries the `Topic:` prefix so the system prompt stays byte-identical across threads
 * and the per-thread prefix stays stable across turns.
 */
export function buildMessages(input: MessagesInput) {
  const turns: TutorTurn[] = [...input.history, { role: 'user', content: input.question }]
  const firstUser = turns.findIndex((turn) => turn.role === 'user')
  return turns.map((turn, index) =>
    index === firstUser
      ? { role: turn.role, content: `Topic: ${input.topicName}\n\n${turn.content}` }
      : { role: turn.role, content: turn.content }
  )
}
