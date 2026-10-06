export type TutorTurn = { role: 'user' | 'assistant'; content: string }
export type TutorStopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'refusal' | 'aborted'
export type TutorUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number }
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
  constructor(message = 'The AI provider failed.', options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'TutorProviderError'
  }
}

export const ZERO_USAGE: TutorUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }

/**
 * The messages sent to the model: the thread history in order, then the new question. The first
 * user turn carries the `Topic:` prefix so the system prompt stays byte-identical across threads
 * and the per-thread prefix stays stable across turns.
 */
export function buildMessages(input: Pick<ExplainInput, 'topicName' | 'history' | 'question'>) {
  const turns: TutorTurn[] = [...input.history, { role: 'user', content: input.question }]
  const firstUser = turns.findIndex((turn) => turn.role === 'user')
  return turns.map((turn, index) =>
    index === firstUser
      ? { role: turn.role, content: `Topic: ${input.topicName}\n\n${turn.content}` }
      : { role: turn.role, content: turn.content }
  )
}
