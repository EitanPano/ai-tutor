import {
  buildMessages,
  TutorProviderError,
  type ExplainInput,
  type ExplainResult,
  type TutorProvider
} from './tutor.js'

/**
 * Deterministic, free tutor used by tests, e2e and default dev. The same input always yields the
 * same answer. Markers in the question trigger failure modes (they mean nothing to the real
 * provider):
 *   [fake:error]       throw TutorProviderError before any delta
 *   [fake:error-mid]   emit 2 deltas, then throw TutorProviderError
 *   [fake:refuse]      emit 2 deltas, then stop with `refusal` (category `cyber`)
 *   [fake:max_tokens]  full stream, then stop with `max_tokens`
 *   [fake:slow]        wait 400 ms between deltas
 */

const MIN_DELTAS = 8
const SLOW_DELAY_MS = 400
const QUOTE_CHARS = 60

const LANGUAGE_BY_TOPIC: Record<string, string> = {
  React: 'tsx',
  TypeScript: 'ts',
  'Node.js': 'ts',
  SQL: 'sql',
  Git: 'bash',
  Docker: 'bash',
  CSS: 'css',
  Python: 'python'
}

function buildAnswer(topicName: string, question: string): string {
  const language = LANGUAGE_BY_TOPIC[topicName] ?? 'js'
  const quoted = question.replace(/\s+/g, ' ').trim().slice(0, QUOTE_CHARS)
  return [
    `Here is a walkthrough for **${quoted}** in ${topicName}. The short version is that the behavior follows from a few rules you can learn once and reuse.`,
    '',
    '### Why it happens',
    '',
    `${topicName} evaluates things in a predictable order, so most surprises come from assuming a different order. Read the example below and trace it step by step.`,
    '',
    '```' + language,
    `// Example for ${topicName}`,
    'const answer = explain(question)',
    '```',
    '',
    '### Try this next',
    '',
    '- Change one input and predict the result before you run it.',
    '- Write a tiny test that pins down the behavior.',
    '- Read the official docs section on this topic.',
    ''
  ].join('\n')
}

/** Splits into at least MIN_DELTAS word groups, keeping whitespace so the parts concat back. */
function splitDeltas(answer: string): string[] {
  const words = answer.match(/\S+\s*|\s+/g) ?? [answer]
  const groupSize = Math.max(1, Math.floor(words.length / MIN_DELTAS / 2))
  const deltas: string[] = []
  for (let i = 0; i < words.length; i += groupSize)
    deltas.push(words.slice(i, i + groupSize).join(''))
  return deltas
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal.aborted) {
      resolve()
      return
    }
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })

export class FakeTutorProvider implements TutorProvider {
  /** Every call's input without the signal, so tests can assert history and prefixes. */
  readonly calls: Omit<ExplainInput, 'signal'>[] = []
  private readonly delayMs: number

  constructor(options: { delayMs?: number } = {}) {
    this.delayMs = options.delayMs ?? 20
  }

  async explain(input: ExplainInput, onDelta: (text: string) => void): Promise<ExplainResult> {
    const { signal, ...recorded } = input
    this.calls.push(recorded)
    const { question } = input
    if (question.includes('[fake:error]')) throw new TutorProviderError('Fake provider error.')

    const deltas = splitDeltas(buildAnswer(input.topicName, question))
    const delay = question.includes('[fake:slow]') ? SLOW_DELAY_MS : this.delayMs
    const inputChars = buildMessages(input).reduce((sum, turn) => sum + turn.content.length, 0)
    const result = (text: string, stopReason: ExplainResult['stopReason']): ExplainResult => ({
      text,
      stopReason,
      refusalCategory: stopReason === 'refusal' ? 'cyber' : null,
      usage: {
        inputTokens: Math.ceil(inputChars / 4),
        outputTokens: Math.ceil(text.length / 4),
        cacheReadTokens: 0
      },
      model: 'fake'
    })

    let text = ''
    for (const [index, delta] of deltas.entries()) {
      if (index > 0) await sleep(delay, signal)
      if (signal.aborted) return result(text, 'aborted')
      text += delta
      onDelta(delta)
      if (index === 1 && question.includes('[fake:error-mid]')) {
        throw new TutorProviderError('Fake provider error.')
      }
      if (index === 1 && question.includes('[fake:refuse]')) return result(text, 'refusal')
    }
    return result(text, question.includes('[fake:max_tokens]') ? 'max_tokens' : 'end_turn')
  }
}
