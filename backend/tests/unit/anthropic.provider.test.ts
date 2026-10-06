import { describe, expect, it } from 'vitest'
import { createAnthropicProvider } from '../../src/lib/tutor/anthropic.provider.js'
import { EXPLAIN_SYSTEM_PROMPT_V1 } from '../../src/lib/tutor/prompt/explain.v1.js'
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

function providerWith(respond: (init?: RequestInit) => Response | Promise<Response>) {
  const captured: Captured = { body: {} }
  const fetchStub = async (_url: unknown, init?: RequestInit) => {
    captured.body = JSON.parse(init?.body as string) as Record<string, unknown>
    return respond(init)
  }
  const provider = createAnthropicProvider({
    apiKey: 'test-key',
    model: 'claude-haiku-4-5',
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
        ...ending('end_turn', { output_tokens: 7, cache_read_input_tokens: 5 })
      ])
    )
    const deltas: string[] = []
    const result = await provider.explain(baseInput(), (text) => deltas.push(text))
    expect(deltas).toEqual(['Hello', ', ', 'world'])
    expect(result).toEqual({
      text: 'Hello, world',
      stopReason: 'end_turn',
      refusalCategory: null,
      usage: { inputTokens: 12, outputTokens: 7, cacheReadTokens: 5 },
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
  }, 20_000)

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

  it('returns aborted with zero usage when aborted before the request starts', async () => {
    const controller = new AbortController()
    controller.abort()
    const { provider } = providerWith(() => sseResponse([]))
    const result = await provider.explain(baseInput(controller.signal), () => {})
    expect(result).toMatchObject({ stopReason: 'aborted', text: '' })
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 })
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
