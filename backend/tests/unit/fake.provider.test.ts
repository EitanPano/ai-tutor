import { describe, expect, it } from 'vitest'
import { FakeTutorProvider } from '../../src/lib/tutor/fake.provider.js'
import { TutorProviderError, type ExplainInput } from '../../src/lib/tutor/tutor.js'

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

  it('[fake:slow] waits between deltas and honours an abort with the text so far', async () => {
    const controller = new AbortController()
    const fake = new FakeTutorProvider({ delayMs: 0 })
    const deltas: string[] = []
    const started = Date.now()
    const result = await fake.explain(
      input('slow [fake:slow]', { signal: controller.signal }),
      (text) => {
        deltas.push(text)
        if (deltas.length === 1) setTimeout(() => controller.abort(), 20)
      }
    )
    expect(Date.now() - started).toBeLessThan(300)
    expect(result.stopReason).toBe('aborted')
    expect(result.text).toBe(deltas.join(''))
    expect(result.text).not.toBe('')
  })

  it('returns aborted with empty text when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { result, deltas } = await run('hello', { signal: controller.signal })
    expect(deltas).toEqual([])
    expect(result).toMatchObject({ stopReason: 'aborted', text: '' })
  })
})
