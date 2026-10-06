import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeTutorProvider } from '../../src/lib/tutor/fake.provider.js'
import { GuideDraftSchema } from '../../src/lib/tutor/guide.schema.js'
import { QuizDraftSchema } from '../../src/lib/tutor/quiz.schema.js'
import {
  TutorProviderError,
  type ExplainInput,
  type GuideInput,
  type QuizInput
} from '../../src/lib/tutor/tutor.js'

function input(question: string, overrides: Partial<ExplainInput> = {}): ExplainInput {
  return {
    topicName: 'React',
    history: [],
    question,
    signal: new AbortController().signal,
    ...overrides
  }
}

async function run(question: string, overrides: Partial<ExplainInput> = {}) {
  const fake = new FakeTutorProvider({ delayMs: 0 })
  const deltas: string[] = []
  const result = await fake.explain(input(question, overrides), (text) => deltas.push(text))
  return { fake, deltas, result }
}

describe('FakeTutorProvider', () => {
  it('is deterministic: the same input gives the same deltas and result', async () => {
    const first = await run('Why does useEffect run twice?')
    const second = await run('Why does useEffect run twice?')
    expect(second.deltas).toEqual(first.deltas)
    expect(second.result).toEqual(first.result)
  })

  it('streams at least 8 deltas that add up to the text', async () => {
    const { deltas, result } = await run('Why does useEffect run twice?')
    expect(deltas.length).toBeGreaterThanOrEqual(8)
    expect(deltas.join('')).toBe(result.text)
    expect(result).toMatchObject({ stopReason: 'end_turn', refusalCategory: null, model: 'fake' })
  })

  it('builds the markdown answer with the quoted question, sections and a tagged code block', async () => {
    const { result } = await run('x'.repeat(100))
    expect(result.text).toContain(`**${'x'.repeat(60)}**`)
    expect(result.text).not.toContain('x'.repeat(61))
    expect(result.text).toContain('### Why it happens')
    expect(result.text).toContain('```tsx')
    expect(result.text).toContain('### Try this next')
  })

  it.each([
    ['React', 'tsx'],
    ['TypeScript', 'ts'],
    ['Node.js', 'ts'],
    ['SQL', 'sql'],
    ['Git', 'bash'],
    ['Docker', 'bash'],
    ['CSS', 'css'],
    ['Python', 'python'],
    ['Testing', 'js']
  ])('uses the %s code fence language %s', async (topicName, language) => {
    const { result } = await run('q', { topicName })
    expect(result.text).toContain('```' + language + '\n')
  })

  it('estimates usage from character counts', async () => {
    const { fake, result } = await run('hello')
    const sent = fake.calls[0]
    expect(sent).toBeDefined()
    const inputChars = `Topic: React\n\nhello`.length
    expect(result.usage).toEqual({
      inputTokens: Math.ceil(inputChars / 4),
      outputTokens: Math.ceil(result.text.length / 4),
      cacheReadTokens: 0
    })
  })

  it('records each call without the signal', async () => {
    const { fake } = await run('hello', { history: [{ role: 'user', content: 'earlier' }] })
    expect(fake.calls).toEqual([
      {
        topicName: 'React',
        history: [{ role: 'user', content: 'earlier' }],
        question: 'hello'
      }
    ])
  })

  it('[fake:error] throws before any delta', async () => {
    const fake = new FakeTutorProvider({ delayMs: 0 })
    const deltas: string[] = []
    await expect(fake.explain(input('boom [fake:error]'), (t) => deltas.push(t))).rejects.toThrow(
      TutorProviderError
    )
    expect(deltas).toEqual([])
  })

  it('[fake:error-mid] emits 2 deltas then throws', async () => {
    const fake = new FakeTutorProvider({ delayMs: 0 })
    const deltas: string[] = []
    await expect(
      fake.explain(input('boom [fake:error-mid]'), (t) => deltas.push(t))
    ).rejects.toThrow(TutorProviderError)
    expect(deltas).toHaveLength(2)
  })

  it('[fake:refuse] emits 2 deltas then refuses with category cyber', async () => {
    const { deltas, result } = await run('no [fake:refuse]')
    expect(deltas).toHaveLength(2)
    expect(result).toMatchObject({ stopReason: 'refusal', refusalCategory: 'cyber' })
  })

  it('[fake:max_tokens] streams everything then stops with max_tokens', async () => {
    const { deltas, result } = await run('long [fake:max_tokens]')
    expect(deltas.length).toBeGreaterThanOrEqual(8)
    expect(result.stopReason).toBe('max_tokens')
  })

  describe('[fake:slow]', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('waits 400 ms between deltas', async () => {
      vi.useFakeTimers()
      const fake = new FakeTutorProvider({ delayMs: 0 })
      const deltas: string[] = []
      const pending = fake.explain(input('slow [fake:slow]'), (text) => deltas.push(text))
      await vi.advanceTimersByTimeAsync(0)
      expect(deltas).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(399)
      expect(deltas).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(deltas).toHaveLength(2)
      await vi.runAllTimersAsync()
      expect((await pending).stopReason).toBe('end_turn')
    })

    it('ends the wait on abort and returns the text so far, without any timer firing', async () => {
      vi.useFakeTimers()
      const controller = new AbortController()
      const fake = new FakeTutorProvider({ delayMs: 0 })
      const deltas: string[] = []
      const pending = fake.explain(
        input('slow [fake:slow]', { signal: controller.signal }),
        (text) => deltas.push(text)
      )
      await vi.advanceTimersByTimeAsync(0)
      controller.abort()
      // No timer is advanced: an abort-unaware wait would leave this promise pending forever.
      const result = await pending
      expect(deltas).toHaveLength(1)
      expect(result.stopReason).toBe('aborted')
      expect(result.text).toBe(deltas.join(''))
    })
  })

  it('returns aborted with empty text when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { result, deltas } = await run('hello', { signal: controller.signal })
    expect(deltas).toEqual([])
    expect(result).toMatchObject({ stopReason: 'aborted', text: '' })
  })
})

describe('FakeTutorProvider generateGuide', () => {
  const guideInput = (question: string, topicName = 'React'): GuideInput => ({
    topicName,
    history: [
      { role: 'user', content: question },
      { role: 'assistant', content: 'An answer.' }
    ]
  })

  it('is deterministic and satisfies GuideDraftSchema with 4 steps naming the topic', async () => {
    const first = await new FakeTutorProvider().generateGuide(guideInput('Why does it re-render?'))
    const second = await new FakeTutorProvider().generateGuide(guideInput('Why does it re-render?'))
    expect(second).toEqual(first)
    const draft = GuideDraftSchema.parse(first.output)
    expect(draft.steps).toHaveLength(4)
    expect(draft.title).toContain('React')
    expect(draft.title).toContain('Why does it re-render?')
    expect(draft.steps.every((step) => step.title.includes('React'))).toBe(true)
    expect(first).toMatchObject({ stopReason: 'end_turn', refusalCategory: null, model: 'fake' })
    expect(first.usage.inputTokens).toBeGreaterThan(0)
    expect(first.usage.outputTokens).toBeGreaterThan(0)
  })

  it('puts a snippet in the topic language on the fix step, and strips markers from the title', async () => {
    const result = await new FakeTutorProvider().generateGuide(
      guideInput('Why? [fake:other]', 'SQL')
    )
    const steps = (result.output as { title: string; steps: { code: string | null }[] }).steps
    expect(steps.filter((step) => step.code !== null)).toHaveLength(1)
    expect(
      (result.output as { steps: { codeLanguage: string | null }[] }).steps.map(
        (step) => step.codeLanguage
      )
    ).toContain('sql')
    expect((result.output as { title: string }).title).not.toContain('[fake')
  })

  it('records each call', async () => {
    const fake = new FakeTutorProvider()
    await fake.generateGuide(guideInput('q'))
    expect(fake.guideCalls).toEqual([guideInput('q')])
  })

  it('[fake:guide-invalid] always fails the schema', async () => {
    const fake = new FakeTutorProvider()
    for (let call = 0; call < 3; call += 1) {
      const result = await fake.generateGuide(guideInput('q [fake:guide-invalid]'))
      expect(GuideDraftSchema.safeParse(result.output).success).toBe(false)
      expect(result.stopReason).toBe('end_turn')
    }
  })

  it('[fake:guide-invalid-once] fails the first call per history, then succeeds', async () => {
    const fake = new FakeTutorProvider()
    const question = 'q [fake:guide-invalid-once]'
    expect(
      GuideDraftSchema.safeParse((await fake.generateGuide(guideInput(question))).output).success
    ).toBe(false)
    expect(
      GuideDraftSchema.safeParse((await fake.generateGuide(guideInput(question))).output).success
    ).toBe(true)
    // A different history starts its own count.
    expect(
      GuideDraftSchema.safeParse((await fake.generateGuide(guideInput(`${question} 2`))).output)
        .success
    ).toBe(false)
  })

  it('[fake:guide-refuse] refuses with category cyber and no output', async () => {
    const result = await new FakeTutorProvider().generateGuide(guideInput('q [fake:guide-refuse]'))
    expect(result).toMatchObject({
      output: null,
      stopReason: 'refusal',
      refusalCategory: 'cyber'
    })
  })

  it('[fake:guide-error] throws TutorProviderError', async () => {
    await expect(
      new FakeTutorProvider().generateGuide(guideInput('q [fake:guide-error]'))
    ).rejects.toThrow(TutorProviderError)
  })

  it('only reads markers from user turns', async () => {
    const result = await new FakeTutorProvider().generateGuide({
      topicName: 'React',
      history: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'mentions [fake:guide-refuse]' }
      ]
    })
    expect(result.stopReason).toBe('end_turn')
  })
})

describe('FakeTutorProvider generateQuiz', () => {
  const quizInput = (
    question: string,
    difficulty: QuizInput['difficulty'] = 'medium',
    topicName = 'React'
  ): QuizInput => ({
    topicName,
    difficulty,
    history: [
      { role: 'user', content: question },
      { role: 'assistant', content: 'An answer.' }
    ]
  })

  it('is deterministic and satisfies QuizDraftSchema with 5 varied, distinct items', async () => {
    const first = await new FakeTutorProvider().generateQuiz(quizInput('Why?', 'hard'))
    const second = await new FakeTutorProvider().generateQuiz(quizInput('Why?', 'hard'))
    expect(second).toEqual(first)
    const parsed = QuizDraftSchema.safeParse(first.output)
    expect(parsed.success).toBe(true)
    const items = parsed.success ? parsed.data.items : []
    expect(items).toHaveLength(5)
    expect(items.map((item) => item.answerIndex)).toEqual([3, 2, 1, 0, 3])
    expect(
      items.every((item) => item.prompt.includes('React') && item.prompt.includes('hard'))
    ).toBe(true)
    expect(first).toMatchObject({ stopReason: 'end_turn', refusalCategory: null, model: 'fake' })
    expect(first.usage.outputTokens).toBeGreaterThan(0)
  })

  it('works without history (a topic-only quiz) and records the call', async () => {
    const fake = new FakeTutorProvider()
    const input: QuizInput = { topicName: 'SQL', difficulty: 'easy', history: null }
    const result = await fake.generateQuiz(input)
    expect(QuizDraftSchema.safeParse(result.output).success).toBe(true)
    expect(fake.quizCalls).toEqual([input])
  })

  it('[fake:quiz-invalid] always fails the schema (duplicate choices)', async () => {
    const fake = new FakeTutorProvider()
    for (let call = 0; call < 3; call += 1) {
      const result = await fake.generateQuiz(quizInput('q [fake:quiz-invalid]'))
      expect(QuizDraftSchema.safeParse(result.output).success).toBe(false)
      expect(result.stopReason).toBe('end_turn')
    }
  })

  it('[fake:quiz-invalid-once] fails the first call per input, then succeeds, until reset', async () => {
    const fake = new FakeTutorProvider()
    const input = quizInput('q [fake:quiz-invalid-once]')
    const valid = async () =>
      QuizDraftSchema.safeParse((await fake.generateQuiz(input)).output).success
    expect(await valid()).toBe(false)
    expect(await valid()).toBe(true)
    fake.reset()
    expect(fake.quizCalls).toHaveLength(0)
    expect(await valid()).toBe(false)
  })

  it('reset() also clears the guide once-counter and the recorded calls', async () => {
    const fake = new FakeTutorProvider()
    const input: GuideInput = {
      topicName: 'React',
      history: [{ role: 'user', content: 'q [fake:guide-invalid-once]' }]
    }
    const valid = async () =>
      GuideDraftSchema.safeParse((await fake.generateGuide(input)).output).success
    expect(await valid()).toBe(false)
    expect(await valid()).toBe(true)
    fake.reset()
    expect(fake.guideCalls).toHaveLength(0)
    expect(await valid()).toBe(false)
  })

  it('[fake:quiz-refuse] refuses with category cyber and no output', async () => {
    const result = await new FakeTutorProvider().generateQuiz(quizInput('q [fake:quiz-refuse]'))
    expect(result).toMatchObject({ output: null, stopReason: 'refusal', refusalCategory: 'cyber' })
  })

  it('[fake:quiz-error] throws TutorProviderError', async () => {
    await expect(
      new FakeTutorProvider().generateQuiz(quizInput('q [fake:quiz-error]'))
    ).rejects.toThrow(TutorProviderError)
  })

  it('only reads markers from user turns', async () => {
    const result = await new FakeTutorProvider().generateQuiz({
      topicName: 'React',
      difficulty: 'easy',
      history: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'mentions [fake:quiz-refuse]' }
      ]
    })
    expect(result.stopReason).toBe('end_turn')
  })
})
