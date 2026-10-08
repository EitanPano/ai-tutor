import { API_URL } from '@/lib/config'
import type { components } from '@/types/api'
import { createSseParser } from '../sse'
import { isErrorResponse, toApiError } from './client'
import { ApiError } from './error'

export type StreamMessageStart = components['schemas']['StreamMessageStart']
export type StreamMessageComplete = components['schemas']['StreamMessageComplete']

export type AskHandlers = {
  signal?: AbortSignal | undefined
  onStart?: (start: StreamMessageStart) => void
  onDelta?: (text: string) => void
  onComplete?: (complete: StreamMessageComplete) => void
}

/** `stopped` means the caller aborted: the server keeps the partial answer, nothing failed. */
export type AskResult = 'completed' | 'stopped'

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError'

const interrupted = () =>
  new ApiError({
    status: 0,
    code: 'stream_interrupted',
    message: 'The answer stopped unexpectedly.'
  })

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return undefined
  }
}

/**
 * Asks a question and streams the answer. Errors before the stream starts are JSON and throw
 * `ApiError`; so does an `error` event or a stream that ends without `message.complete`.
 */
export async function askQuestion(
  threadId: string,
  content: string,
  { signal, onStart, onDelta, onComplete }: AskHandlers = {}
): Promise<AskResult> {
  let response: Response
  try {
    response = await fetch(`${API_URL}/api/thread/${encodeURIComponent(threadId)}/message`, {
      method: 'POST',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ content }),
      ...(signal && { signal })
    })
  } catch (err) {
    if (isAbort(err)) return 'stopped'
    throw new ApiError({
      status: 0,
      code: 'network_error',
      message: 'The request did not reach the server.'
    })
  }

  if (!response.ok) throw await toApiError(response)
  if (!response.body) throw interrupted()

  let completed = false
  let failure: ApiError | undefined
  const feed = createSseParser(({ event, data }) => {
    if (completed || failure) return
    const payload = parseJson(data)
    if (event === 'message.start') onStart?.(payload as StreamMessageStart)
    else if (event === 'delta') onDelta?.((payload as { text: string }).text)
    else if (event === 'message.complete') {
      completed = true
      onComplete?.(payload as StreamMessageComplete)
    } else if (event === 'error') {
      failure = isErrorResponse(payload)
        ? new ApiError({
            status: response.status,
            code: payload.error.code,
            message: payload.error.message,
            details: payload.error.details,
            requestId: payload.requestId
          })
        : interrupted()
    }
  })

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      feed(decoder.decode(value, { stream: true }))
      if (failure) {
        void reader.cancel().catch(() => undefined)
        throw failure
      }
    }
  } catch (err) {
    if (err === failure) throw err
    if (isAbort(err) || signal?.aborted) return 'stopped'
    throw interrupted()
  }

  if (failure) throw failure
  if (!completed) {
    if (signal?.aborted) return 'stopped'
    throw interrupted()
  }
  return 'completed'
}
