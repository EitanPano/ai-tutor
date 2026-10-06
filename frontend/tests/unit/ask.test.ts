import { afterEach, describe, expect, it, vi } from 'vitest'
import { askQuestion } from '@/lib/api/ask'
import { ApiError } from '@/lib/api/error'
import { errorResponse } from './test-utils'

const encoder = new TextEncoder()

function sseResponse(chunks: string[], signal?: AbortSignal | null, hold = false) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener('abort', () =>
        controller.error(new DOMException('Aborted', 'AbortError'))
      )
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      if (!hold) controller.close()
    }
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const start = { threadId: 't1', userMessageId: 'u1', assistantMessageId: 'a1' }
const complete = {
  messageId: 'a1',
  status: 'complete',
  stopReason: 'end_turn',
  usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0 }
}

function handlers() {
  const calls: string[] = []
  return {
    calls,
    onStart: () => calls.push('start'),
    onDelta: (text: string) => calls.push(`delta:${text}`),
    onComplete: () => calls.push('complete')
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('askQuestion', () => {
  it('posts the question and dispatches events in order', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        sseResponse([
          ': ping\n\n',
          frame('message.start', start),
          frame('delta', { text: 'Hel' }).slice(0, 20),
          frame('delta', { text: 'Hel' }).slice(20) + frame('delta', { text: 'lo' }),
          frame('message.complete', complete)
        ])
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const h = handlers()

    const result = await askQuestion('t1', 'why?', h)

    expect(result).toBe('completed')
    expect(h.calls).toEqual(['start', 'delta:Hel', 'delta:lo', 'complete'])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/api\/thread\/t1\/message$/)
    expect(init.credentials).toBe('include')
    expect(JSON.parse(init.body as string)).toEqual({ content: 'why?' })
  })

  it('throws ApiError for a JSON error before the stream starts', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(errorResponse(429, 'ai_budget_exceeded', 'Spent')))
    const h = handlers()

    const failure = await askQuestion('t1', 'q', h).catch((err: unknown) => err)

    expect(failure).toBeInstanceOf(ApiError)
    expect(failure).toMatchObject({ status: 429, code: 'ai_budget_exceeded', requestId: 'r1' })
    expect(h.calls).toEqual([])
  })

  it('throws ApiError built from an error event', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        sseResponse([
          frame('message.start', start),
          frame('error', { error: { code: 'ai_provider_error', message: 'Boom' }, requestId: 'r9' })
        ])
      )
    )

    const failure = await askQuestion('t1', 'q', handlers()).catch((err: unknown) => err)

    expect(failure).toMatchObject({ code: 'ai_provider_error', message: 'Boom', requestId: 'r9' })
  })

  it('resolves as stopped when aborted mid-stream', async () => {
    const abort = new AbortController()
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) =>
      Promise.resolve(
        sseResponse(
          [frame('message.start', start), frame('delta', { text: 'a' })],
          init.signal,
          true
        )
      )
    )
    const h = handlers()

    const result = await askQuestion('t1', 'q', {
      ...h,
      signal: abort.signal,
      onDelta: (text) => {
        h.onDelta(text)
        abort.abort()
      }
    })

    expect(result).toBe('stopped')
    expect(h.calls).toEqual(['start', 'delta:a'])
  })

  it('resolves as stopped when aborted before the response arrives', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new DOMException('Aborted', 'AbortError')))
    await expect(askQuestion('t1', 'q', { signal: AbortSignal.abort() })).resolves.toBe('stopped')
  })

  it('throws stream_interrupted when the stream ends without a completion', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(sseResponse([frame('message.start', start), frame('delta', { text: 'a' })]))
    )

    const failure = await askQuestion('t1', 'q', handlers()).catch((err: unknown) => err)

    expect(failure).toMatchObject({ code: 'stream_interrupted' })
  })

  it('maps a network failure to network_error', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))

    const failure = await askQuestion('t1', 'q').catch((err: unknown) => err)

    expect(failure).toMatchObject({ code: 'network_error', status: 0 })
  })
})
