import { describe, expect, it } from 'vitest'
import { createAnthropicProvider } from '../../src/lib/tutor/anthropic.provider.js'
import { EXPLAIN_SYSTEM_PROMPT_V1 } from '../../src/lib/tutor/prompt/explain.v1.js'
import { GUIDE_SYSTEM_PROMPT_V1 } from '../../src/lib/tutor/prompt/guide.v1.js'
import { QUIZ_SYSTEM_PROMPT_V1 } from '../../src/lib/tutor/prompt/quiz.v1.js'
import { TutorProviderError } from '../../src/lib/tutor/tutor.js'

type Frame = [event: string, data: unknown]

function sseBody(frames: Frame[]): string {
  return frames
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('')
}

function messageStart(usage: Record<string, unknown> = {}): Frame {
  return [
    'message_start',
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        stop_details: null,
        usage: { input_tokens: 12, output_tokens: 1, ...usage }
      }
    }
  ]
}

function textFrames(deltas: string[]): Frame[] {
  return [
    [
      'content_block_start',
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
    ],
    ...deltas.map((text): Frame => [
      'content_block_delta',
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }
    ]),
    ['content_block_stop', { type: 'content_block_stop', index: 0 }]
  ]
}

function ending(
  stopReason: string,
  usage: Record<string, unknown>,
  stopDetails?: Record<string, unknown>
): Frame[] {
  return [
    [
      'message_delta',
      {
        type: 'message_delta',
        delta: {
          stop_reason: stopReason,
          stop_sequence: null,
          ...(stopDetails ? { stop_details: stopDetails } : {})
        },
        usage
      }
    ],
    ['message_stop', { type: 'message_stop' }]
  ]
}

function sseResponse(frames: Frame[]): Response {
  return new Response(sseBody(frames), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  })
}

type Captured = { body: Record<string, unknown> }

function providerWith(
  respond: (init?: RequestInit) => Response | Promise<Response>,
  maxRetries = 0,
  timeouts: { explainIdleTimeoutMs?: number; explainTotalTimeoutMs?: number } = {}
) {
  const captured: Captured = { body: {} }
  const fetchStub = async (_url: unknown, init?: RequestInit) => {
    captured.body = JSON.parse(init?.body as string) as Record<string, unknown>
    return respond(init)
  }
  const provider = createAnthropicProvider({
    apiKey: 'test-key',
    model: 'claude-haiku-4-5',
    maxRetries,
    ...timeouts,
    fetch: fetchStub
  })
  return { provider, captured }
}

const baseInput = (signal = new AbortController().signal) => ({
  topicName: 'TypeScript',
  history: [
    { role: 'user' as const, content: 'What is a generic?' },
    { role: 'assistant' as const, content: 'A type parameter.' }
  ],
  question: 'Show an example',
  signal
})

describe('anthropic provider', () => {
  it('forwards deltas, maps end_turn and usage including cache reads', async () => {
    const { provider } = providerWith(() =>
      sseResponse([
        messageStart(),
        ...textFrames(['Hello', ', ', 'world']),
        ...ending('end_turn', {
          output_tokens: 7,
          cache_read_input_tokens: 5,
          cache_creation_input_tokens: 3
        })
      ])
    )
    const deltas: string[] = []
    const result = await provider.explain(baseInput(), (text) => deltas.push(text))
    expect(deltas).toEqual(['Hello', ', ', 'world'])
    expect(result).toEqual({
      text: 'Hello, world',
      stopReason: 'end_turn',
      refusalCategory: null,
      usage: { inputTokens: 12, outputTokens: 7, cacheReadTokens: 5, cacheCreationTokens: 3 },
      model: 'claude-haiku-4-5'
    })
  })

  it('treats a missing cache_read_input_tokens as zero', async () => {
    const { provider } = providerWith(() =>
      sseResponse([
        messageStart(),
        ...textFrames(['ok']),
        ...ending('end_turn', { output_tokens: 2 })
      ])
    )
    const result = await provider.explain(baseInput(), () => {})
    expect(result.usage.cacheReadTokens).toBe(0)
  })

  it('maps max_tokens', async () => {
    const { provider } = providerWith(() =>
      sseResponse([
        messageStart(),
        ...textFrames(['cut']),
        ...ending('max_tokens', { output_tokens: 2048 })
      ])
    )
    const result = await provider.explain(baseInput(), () => {})
    expect(result).toMatchObject({ text: 'cut', stopReason: 'max_tokens', refusalCategory: null })
  })

  it('maps a refusal with stop_details.category', async () => {
    const { provider } = providerWith(() =>
      sseResponse([
        messageStart(),
        ...textFrames(['par']),
        ...ending('refusal', { output_tokens: 3 }, { type: 'refusal', category: 'cyber' })
      ])
    )
    const result = await provider.explain(baseInput(), () => {})
    expect(result).toMatchObject({ stopReason: 'refusal', refusalCategory: 'cyber' })
  })

  it('maps a refusal without stop_details to a null category', async () => {
    const { provider } = providerWith(() =>
      sseResponse([
        messageStart(),
        ...textFrames(['par']),
        ...ending('refusal', { output_tokens: 3 })
      ])
    )
    const result = await provider.explain(baseInput(), () => {})
    expect(result).toMatchObject({ stopReason: 'refusal', refusalCategory: null })
  })

  it('throws TutorProviderError on a 500 without leaking the provider payload', async () => {
    const { provider } = providerWith(
      () =>
        new Response(
          JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'SECRET-DETAIL' } }),
          { status: 500, headers: { 'content-type': 'application/json' } }
        )
    )
    const error = await provider.explain(baseInput(), () => {}).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(TutorProviderError)
    expect((error as Error).message).not.toContain('SECRET-DETAIL')
  })

  it('throws TutorProviderError on a 400', async () => {
    const { provider } = providerWith(
      () =>
        new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: 'bad' }
          }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        )
    )
    await expect(provider.explain(baseInput(), () => {})).rejects.toThrow(TutorProviderError)
  })

  it('fails with the usage seen so far when the stream goes idle', async () => {
    const encoder = new TextEncoder()
    const { provider } = providerWith(
      (init) => {
        const head = sseBody([messageStart(), ...textFrames(['z'.repeat(90)])])
        const body = new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(encoder.encode(head))
            // Headers and one delta arrive, then nothing, until the request is aborted.
            init?.signal?.addEventListener('abort', () =>
              stream.error(new DOMException('The operation was aborted.', 'AbortError'))
            )
          }
        })
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      },
      0,
      { explainIdleTimeoutMs: 50 }
    )
    const error = await provider.explain(baseInput(), () => {}).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(TutorProviderError)
    expect((error as TutorProviderError).usage).toEqual({
      inputTokens: 12,
      outputTokens: 30,
      cacheReadTokens: 0,
      cacheCreationTokens: 0
    })
  })

  it('fails when a stream that keeps sending events outlasts the total deadline', async () => {
    const encoder = new TextEncoder()
    let ticker: ReturnType<typeof setInterval> | undefined
    const { provider } = providerWith(
      (init) => {
        const body = new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(encoder.encode(sseBody([messageStart(), ...textFrames([])])))
            ticker = setInterval(() => {
              stream.enqueue(encoder.encode(sseBody([['ping', { type: 'ping' }]])))
            }, 10)
            init?.signal?.addEventListener('abort', () => {
              clearInterval(ticker)
              stream.error(new DOMException('The operation was aborted.', 'AbortError'))
            })
          }
        })
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      },
      0,
      { explainIdleTimeoutMs: 1_000, explainTotalTimeoutMs: 150 }
    )
    try {
      await expect(provider.explain(baseInput(), () => {})).rejects.toThrow(TutorProviderError)
    } finally {
      clearInterval(ticker)
    }
  })

  it('returns aborted with the text so far when the signal aborts mid-stream', async () => {
    const controller = new AbortController()
    const encoder = new TextEncoder()
    const { provider } = providerWith((init) => {
      const head = sseBody([messageStart(), ...textFrames(['Partial'])])
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(encoder.encode(head))
          // Like a real fetch body, the stream only ends when the request signal aborts.
          init?.signal?.addEventListener('abort', () =>
            stream.error(new DOMException('The operation was aborted.', 'AbortError'))
          )
        }
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    const deltas: string[] = []
    const result = await provider.explain(baseInput(controller.signal), (text) => {
      deltas.push(text)
      controller.abort()
    })
    expect(deltas).toEqual(['Partial'])
    expect(result).toMatchObject({ stopReason: 'aborted', text: 'Partial', refusalCategory: null })
    expect(result.usage.inputTokens).toBe(12)
  })

  it('estimates the output of an aborted answer from the streamed text', async () => {
    const controller = new AbortController()
    const encoder = new TextEncoder()
    const partial = 'x'.repeat(300)
    const { provider } = providerWith((init) => {
      const head = sseBody([
        messageStart({ cache_creation_input_tokens: 40 }),
        ...textFrames([partial])
      ])
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(encoder.encode(head))
          init?.signal?.addEventListener('abort', () =>
            stream.error(new DOMException('The operation was aborted.', 'AbortError'))
          )
        }
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    const result = await provider.explain(baseInput(controller.signal), () => controller.abort())
    expect(result.stopReason).toBe('aborted')
    // message_start reports output_tokens: 1; the estimate (ceil(300 / 3)) must win.
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheCreationTokens: 40
    })
  })

  it('carries the usage seen so far on a mid-stream provider error', async () => {
    const encoder = new TextEncoder()
    const { provider } = providerWith(() => {
      const head = sseBody([messageStart(), ...textFrames(['y'.repeat(90)])])
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(encoder.encode(head))
          setTimeout(() => stream.error(new Error('connection reset')), 20)
        }
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    const error = await provider.explain(baseInput(), () => {}).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(TutorProviderError)
    expect((error as TutorProviderError).usage).toEqual({
      inputTokens: 12,
      outputTokens: 30,
      cacheReadTokens: 0,
      cacheCreationTokens: 0
    })
  })

  it('records an estimated input when aborted after the request was sent but before message_start', async () => {
    const controller = new AbortController()
    const { provider } = providerWith((init) => {
      // Headers never arrive; the request only ends when its signal aborts.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        )
        setTimeout(() => controller.abort(), 10)
      })
    })
    const result = await provider.explain(baseInput(controller.signal), () => {})
    const chars =
      EXPLAIN_SYSTEM_PROMPT_V1.length +
      `Topic: TypeScript

What is a generic?`.length +
      'A type parameter.'.length +
      'Show an example'.length
    expect(result).toMatchObject({ stopReason: 'aborted', text: '' })
    expect(result.usage.inputTokens).toBe(Math.ceil(chars / 4))
    expect(result.usage.outputTokens).toBe(0)
  })

  it('returns aborted with zero usage when aborted before the request starts', async () => {
    const controller = new AbortController()
    controller.abort()
    const { provider } = providerWith(() => sseResponse([]))
    const result = await provider.explain(baseInput(controller.signal), () => {})
    expect(result).toMatchObject({ stopReason: 'aborted', text: '' })
    expect(result.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0
    })
  })

  it('sends the documented request body and nothing Haiku 4.5 rejects', async () => {
    const { provider, captured } = providerWith(() =>
      sseResponse([
        messageStart(),
        ...textFrames(['ok']),
        ...ending('end_turn', { output_tokens: 1 })
      ])
    )
    await provider.explain(baseInput(), () => {})
    const body = captured.body
    expect(body.model).toBe('claude-haiku-4-5')
    expect(body.max_tokens).toBe(2048)
    expect(body.stream).toBe(true)
    expect(body.cache_control).toEqual({ type: 'ephemeral' })
    expect(body.system).toEqual([{ type: 'text', text: EXPLAIN_SYSTEM_PROMPT_V1 }])
    expect(body.messages).toEqual([
      { role: 'user', content: 'Topic: TypeScript\n\nWhat is a generic?' },
      { role: 'assistant', content: 'A type parameter.' },
      { role: 'user', content: 'Show an example' }
    ])
    for (const key of ['thinking', 'output_config', 'effort', 'temperature']) {
      expect(body).not.toHaveProperty(key)
    }
  })

  it('prefixes the question itself when the thread has no history', async () => {
    const { provider, captured } = providerWith(() =>
      sseResponse([
        messageStart(),
        ...textFrames(['ok']),
        ...ending('end_turn', { output_tokens: 1 })
      ])
    )
    await provider.explain({ ...baseInput(), history: [] }, () => {})
    expect(captured.body.messages).toEqual([
      { role: 'user', content: 'Topic: TypeScript\n\nShow an example' }
    ])
  })
})

const GUIDE = {
  title: 'Fix the double effect',
  steps: [
    { title: 'One', body: 'Do one', code: null, codeLanguage: null, hint: 'Think' },
    { title: 'Two', body: 'Do two', code: 'x', codeLanguage: 'ts', hint: 'Look' },
    { title: 'Three', body: 'Do three', code: null, codeLanguage: null, hint: 'Check' }
  ]
}

function jsonMessage(
  text: string,
  stopReason = 'end_turn',
  extra: Record<string, unknown> = {}
): Response {
  return new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5',
      content: text === '' ? [] : [{ type: 'text', text }],
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: 30,
        output_tokens: 90,
        cache_read_input_tokens: 4,
        cache_creation_input_tokens: 6
      },
      ...extra
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

const guideInput = {
  topicName: 'React',
  history: [
    { role: 'user' as const, content: 'Why does useEffect run twice?' },
    { role: 'assistant' as const, content: 'Strict Mode.' }
  ]
}

describe('anthropic provider generateGuide', () => {
  it('returns the parsed output, usage and model', async () => {
    const { provider } = providerWith(() => jsonMessage(JSON.stringify(GUIDE)))
    const result = await provider.generateGuide(guideInput)
    expect(result).toEqual({
      output: GUIDE,
      stopReason: 'end_turn',
      refusalCategory: null,
      usage: { inputTokens: 30, outputTokens: 90, cacheReadTokens: 4, cacheCreationTokens: 6 },
      model: 'claude-haiku-4-5'
    })
  })

  it('hands back output that does not satisfy the schema; validating is the caller job', async () => {
    const { provider } = providerWith(() => jsonMessage(JSON.stringify({ title: 'x', steps: [] })))
    const result = await provider.generateGuide(guideInput)
    expect(result.output).toEqual({ title: 'x', steps: [] })
  })

  it('returns a null output for text that is not JSON', async () => {
    const { provider } = providerWith(() => jsonMessage('not json'))
    const result = await provider.generateGuide(guideInput)
    expect(result).toMatchObject({ output: null, stopReason: 'end_turn' })
  })

  it('maps a refusal with its category and no output', async () => {
    const { provider } = providerWith(() =>
      jsonMessage('', 'refusal', { stop_details: { type: 'refusal', category: 'cyber' } })
    )
    const result = await provider.generateGuide(guideInput)
    expect(result).toMatchObject({
      output: null,
      stopReason: 'refusal',
      refusalCategory: 'cyber'
    })
  })

  it('treats max_tokens as no output even when the text is parseable', async () => {
    const { provider } = providerWith(() => jsonMessage(JSON.stringify(GUIDE), 'max_tokens'))
    const result = await provider.generateGuide(guideInput)
    expect(result).toMatchObject({ output: null, stopReason: 'max_tokens' })
  })

  it('throws TutorProviderError on a 500 without leaking the provider payload', async () => {
    const { provider } = providerWith(
      () =>
        new Response(
          JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'SECRET-DETAIL' } }),
          { status: 500, headers: { 'content-type': 'application/json' } }
        )
    )
    const error = await provider.generateGuide(guideInput).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(TutorProviderError)
    expect((error as Error).message).not.toContain('SECRET-DETAIL')
  })

  it('sends the documented non-streaming structured-output request', async () => {
    const { provider, captured } = providerWith(() => jsonMessage(JSON.stringify(GUIDE)))
    await provider.generateGuide(guideInput)
    const body = captured.body
    expect(body.model).toBe('claude-haiku-4-5')
    expect(body.max_tokens).toBe(4096)
    expect(body).not.toHaveProperty('stream')
    expect(body.cache_control).toEqual({ type: 'ephemeral' })
    expect(body.system).toEqual([{ type: 'text', text: GUIDE_SYSTEM_PROMPT_V1 }])
    expect(body.messages).toEqual([
      { role: 'user', content: 'Topic: React\n\nWhy does useEffect run twice?' },
      { role: 'assistant', content: 'Strict Mode.' },
      { role: 'user', content: 'Write the step-by-step guide for this conversation.' }
    ])
    const format = (body.output_config as { format: { type: string; schema: object } }).format
    expect(format.type).toBe('json_schema')
    expect(format.schema).toMatchObject({ type: 'object', required: ['title', 'steps'] })
    expect(format).not.toHaveProperty('parse')
    for (const key of ['thinking', 'effort', 'temperature', 'output_format']) {
      expect(body).not.toHaveProperty(key)
    }
    expect(body.output_config).not.toHaveProperty('effort')
  })
})

const QUIZ = {
  items: [1, 2, 3, 4, 5].map((n) => ({
    prompt: `Question ${n}`,
    choices: ['a', 'b', 'c', 'd'],
    answerIndex: n % 4,
    explanation: `Because ${n}`
  }))
}

describe('anthropic provider generateQuiz', () => {
  it('returns the parsed output, usage and model', async () => {
    const { provider } = providerWith(() => jsonMessage(JSON.stringify(QUIZ)))
    const result = await provider.generateQuiz({ ...guideInput, difficulty: 'easy' })
    expect(result).toEqual({
      output: QUIZ,
      stopReason: 'end_turn',
      refusalCategory: null,
      usage: { inputTokens: 30, outputTokens: 90, cacheReadTokens: 4, cacheCreationTokens: 6 },
      model: 'claude-haiku-4-5'
    })
  })

  it('maps a refusal, a truncation and non-JSON text to a null output', async () => {
    const input = { ...guideInput, difficulty: 'easy' as const }
    const refusal = providerWith(() =>
      jsonMessage('', 'refusal', { stop_details: { type: 'refusal', category: 'cyber' } })
    )
    expect(await refusal.provider.generateQuiz(input)).toMatchObject({
      output: null,
      stopReason: 'refusal',
      refusalCategory: 'cyber'
    })
    const truncated = providerWith(() => jsonMessage(JSON.stringify(QUIZ), 'max_tokens'))
    expect(await truncated.provider.generateQuiz(input)).toMatchObject({
      output: null,
      stopReason: 'max_tokens'
    })
    const text = providerWith(() => jsonMessage('not json'))
    expect(await text.provider.generateQuiz(input)).toMatchObject({ output: null })
  })

  it('throws TutorProviderError on a 500 without leaking the provider payload', async () => {
    const { provider } = providerWith(
      () =>
        new Response(
          JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'SECRET-DETAIL' } }),
          { status: 500, headers: { 'content-type': 'application/json' } }
        )
    )
    const error = await provider
      .generateQuiz({ ...guideInput, difficulty: 'easy' })
      .catch((err: unknown) => err)
    expect(error).toBeInstanceOf(TutorProviderError)
    expect((error as Error).message).not.toContain('SECRET-DETAIL')
  })

  it('sends the structured-output request with the history and the difficulty turn', async () => {
    const { provider, captured } = providerWith(() => jsonMessage(JSON.stringify(QUIZ)))
    await provider.generateQuiz({ ...guideInput, difficulty: 'hard' })
    const body = captured.body
    expect(body.max_tokens).toBe(4096)
    expect(body).not.toHaveProperty('stream')
    expect(body.cache_control).toEqual({ type: 'ephemeral' })
    expect(body.system).toEqual([{ type: 'text', text: QUIZ_SYSTEM_PROMPT_V1 }])
    expect(body.messages).toEqual([
      { role: 'user', content: 'Topic: React\n\nWhy does useEffect run twice?' },
      { role: 'assistant', content: 'Strict Mode.' },
      { role: 'user', content: 'Write a hard quiz on this conversation.' }
    ])
    const format = (body.output_config as { format: { type: string; schema: object } }).format
    expect(format.type).toBe('json_schema')
    expect(format.schema).toMatchObject({ type: 'object', required: ['items'] })
    for (const key of ['thinking', 'effort', 'temperature', 'output_format']) {
      expect(body).not.toHaveProperty(key)
    }
  })

  it('sends only the Topic-prefixed request for a topic-only quiz', async () => {
    const { provider, captured } = providerWith(() => jsonMessage(JSON.stringify(QUIZ)))
    await provider.generateQuiz({ topicName: 'SQL', difficulty: 'easy', history: null })
    expect(captured.body.messages).toEqual([
      { role: 'user', content: 'Topic: SQL\n\nWrite an easy quiz about SQL.' }
    ])
  })
})
