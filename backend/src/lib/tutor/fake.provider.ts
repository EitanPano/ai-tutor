import {
  buildMessages,
  TutorProviderError,
  type ExplainInput,
  type ExplainResult,
  type GuideInput,
  type QuizInput,
  type StructuredResult,
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
 * Markers in a user turn of the history drive `generateGuide`:
 *   [fake:guide-invalid]       every call returns a draft that fails GuideDraftSchema
 *   [fake:guide-invalid-once]  the first call for a given history is invalid, the next valid
 *   [fake:guide-refuse]        refusal (category `cyber`)
 *   [fake:guide-error]         throw TutorProviderError
 * Markers in a user turn of the history drive `generateQuiz` the same way (a quiz from a topic
 * alone has no history, so no markers):
 *   [fake:quiz-invalid]        every call returns a draft with duplicate choices
 *   [fake:quiz-invalid-once]   the first call for a given input is invalid, the next valid
 *   [fake:quiz-refuse]         refusal (category `cyber`)
 *   [fake:quiz-error]          throw TutorProviderError
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

const MARKER = /\[fake:[a-z_-]+\]/g

function lastUserQuestion(history: GuideInput['history']): string {
  const turn = history.findLast((entry) => entry.role === 'user')
  const cleaned = (turn?.content ?? '').replace(MARKER, '').replace(/\s+/g, ' ').trim()
  return cleaned.slice(0, QUOTE_CHARS) || 'your question'
}

function buildGuide(topicName: string, question: string) {
  const language = LANGUAGE_BY_TOPIC[topicName] ?? 'js'
  return {
    title: `${topicName} guide: ${question}`.slice(0, 120),
    steps: [
      {
        title: `Reproduce the ${topicName} problem`,
        body: `Create the smallest ${topicName} example that shows **${question}** and confirm you can trigger it on demand.`,
        code: null,
        codeLanguage: null,
        hint: 'Remove everything that is not needed to see the problem.'
      },
      {
        title: `Read the key ${topicName} concept`,
        body: `Find the rule in ${topicName} that explains the behavior and write it down in one sentence.`,
        code: null,
        codeLanguage: null,
        hint: 'The official docs usually name the concept in a heading.'
      },
      {
        title: `Apply the fix in ${topicName}`,
        body: 'Change the example so it follows the rule, then compare it with the original.',
        code: `// Fixed ${topicName} example\nconst answer = explain(question)`,
        codeLanguage: language,
        hint: 'Change one thing at a time so you know which change fixed it.'
      },
      {
        title: `Verify the ${topicName} fix`,
        body: 'Run the example again and add a small test that would fail without the fix.',
        code: null,
        codeLanguage: null,
        hint: 'Write the test first and watch it fail.'
      }
    ]
  }
}

function buildQuiz(topicName: string, difficulty: QuizInput['difficulty']) {
  return {
    items: [1, 2, 3, 4, 5].map((position) => {
      const answerIndex = (position * 3) % 4
      return {
        prompt: `Question ${position}: which statement about ${topicName} is correct? (${difficulty})`,
        choices: [0, 1, 2, 3].map((index) =>
          index === answerIndex
            ? `The ${difficulty} ${topicName} rule for item ${position}`
            : `A common ${topicName} misconception ${index + 1} for item ${position}`
        ),
        answerIndex,
        explanation: `Choice ${answerIndex + 1} is right because it follows the ${topicName} rule; the others are common misconceptions.`
      }
    })
  }
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
  readonly model = 'fake'
  readonly calls: Omit<ExplainInput, 'signal'>[] = []
  /** Every `generateGuide` input, in call order. */
  readonly guideCalls: GuideInput[] = []
  /** Every `generateQuiz` input, in call order. */
  readonly quizCalls: QuizInput[] = []
  /** Calls seen per history, for `[fake:guide-invalid-once]`. */
  private readonly guideAttempts = new Map<string, number>()
  /** Calls seen per input, for `[fake:quiz-invalid-once]`. */
  private readonly quizAttempts = new Map<string, number>()
  private readonly delayMs: number

  constructor(options: { delayMs?: number } = {}) {
    this.delayMs = options.delayMs ?? 20
  }

  /**
   * Forgets every recorded call and every once-counter. Tests call it in `beforeEach` so two
   * tests that send the same text cannot see each other's "once" state.
   */
  reset(): void {
    this.calls.length = 0
    this.guideCalls.length = 0
    this.quizCalls.length = 0
    this.guideAttempts.clear()
    this.quizAttempts.clear()
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
        cacheReadTokens: 0,
        cacheCreationTokens: 0
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

  generateGuide(input: GuideInput): Promise<StructuredResult> {
    try {
      return Promise.resolve(this.buildGuideResult(input))
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)))
    }
  }

  private buildGuideResult(input: GuideInput): StructuredResult {
    this.guideCalls.push(input)
    const userText = input.history
      .filter((turn) => turn.role === 'user')
      .map((turn) => turn.content)
      .join('\n')
    if (userText.includes('[fake:guide-error]'))
      throw new TutorProviderError('Fake provider error.')

    const key = JSON.stringify([input.topicName, input.history])
    const attempt = (this.guideAttempts.get(key) ?? 0) + 1
    this.guideAttempts.set(key, attempt)

    const guide = buildGuide(input.topicName, lastUserQuestion(input.history))
    const refuse = userText.includes('[fake:guide-refuse]')
    const invalid =
      userText.includes('[fake:guide-invalid]') ||
      (userText.includes('[fake:guide-invalid-once]') && attempt === 1)
    const output = refuse ? null : invalid ? { ...guide, steps: guide.steps.slice(0, 2) } : guide
    const inputChars = buildMessages({ ...input, question: '' }).reduce(
      (sum, turn) => sum + turn.content.length,
      0
    )
    return {
      output,
      stopReason: refuse ? 'refusal' : 'end_turn',
      refusalCategory: refuse ? 'cyber' : null,
      usage: {
        inputTokens: Math.ceil(inputChars / 4),
        outputTokens: Math.ceil(JSON.stringify(output).length / 4),
        cacheReadTokens: 0,
        cacheCreationTokens: 0
      },
      model: 'fake'
    }
  }

  generateQuiz(input: QuizInput): Promise<StructuredResult> {
    try {
      return Promise.resolve(this.buildQuizResult(input))
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)))
    }
  }

  private buildQuizResult(input: QuizInput): StructuredResult {
    this.quizCalls.push(input)
    const userText = (input.history ?? [])
      .filter((turn) => turn.role === 'user')
      .map((turn) => turn.content)
      .join('\n')
    if (userText.includes('[fake:quiz-error]')) throw new TutorProviderError('Fake provider error.')

    const key = JSON.stringify([input.topicName, input.difficulty, input.history])
    const attempt = (this.quizAttempts.get(key) ?? 0) + 1
    this.quizAttempts.set(key, attempt)

    const quiz = buildQuiz(input.topicName, input.difficulty)
    const refuse = userText.includes('[fake:quiz-refuse]')
    const invalid =
      userText.includes('[fake:quiz-invalid]') ||
      (userText.includes('[fake:quiz-invalid-once]') && attempt === 1)
    const [first, ...rest] = quiz.items
    const output = refuse
      ? null
      : invalid && first
        ? { items: [{ ...first, choices: first.choices.map(() => 'Same choice') }, ...rest] }
        : quiz
    const inputChars = buildMessages({
      topicName: input.topicName,
      history: input.history ?? [],
      question: ''
    }).reduce((sum, turn) => sum + turn.content.length, 0)
    return {
      output,
      stopReason: refuse ? 'refusal' : 'end_turn',
      refusalCategory: refuse ? 'cyber' : null,
      usage: {
        inputTokens: Math.ceil(inputChars / 4),
        outputTokens: Math.ceil(JSON.stringify(output).length / 4),
        cacheReadTokens: 0,
        cacheCreationTokens: 0
      },
      model: 'fake'
    }
  }
}
