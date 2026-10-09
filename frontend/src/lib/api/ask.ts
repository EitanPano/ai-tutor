import { API_URL } from '@/lib/config'
import type { components } from '@/types/api'
import { createSseParser } from '../sse'
import { apiErrorFrom, isAbortError, isErrorResponse, networkError, toApiError } from './client'
import { ApiError } from './error'

type StreamMessageStart = components['schemas']['StreamMessageStart']
type StreamMessageComplete = components['schemas']['StreamMessageComplete']

export type AskHandlers = {
  signal?: AbortSignal | undefined
  onStart?: (start: StreamMessageStart) => void
  onDelta?: (text: string) => void
  onComplete?: (complete: StreamMessageComplete) => void
}

/** `stopped` means the caller aborted: the server keeps the partial answer, nothing failed. */
export type AskResult = 'completed' | 'stopped'

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
    if (isAbortError(err)) return 'stopped'
    throw networkError()
  }

  if (!response.ok) throw await toApiError(response)
  if (!response.body) throw interrupted()

  let isCompleted = false
  let failure: ApiError | undefined
  // A Map, not an object: the event name comes off the wire and must never reach a prototype key.
  const handlerByEvent = new Map<string, (payload: unknown) => void>([
    ['message.start', (payload) => onStart?.(payload as StreamMessageStart)],
    ['delta', (payload) => onDelta?.((payload as { text: string }).text)],
    [
      'message.complete',
      (payload) => {
        isCompleted = true
        onComplete?.(payload as StreamMessageComplete)
      }
    ],
    [
      'error',
      (payload) => {
        failure = isErrorResponse(payload) ? apiErrorFrom(response.status, payload) : interrupted()
      }
    ]
  ])
  // Nothing after the end of the answer or a failure counts; an unknown event is ignored.
  const feed = createSseParser(({ event, data }) => {
    if (isCompleted || failure) return
    handlerByEvent.get(event)?.(parseJson(data))
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
    if (isAbortError(err) || signal?.aborted) return 'stopped'
    throw interrupted()
  }

  if (failure) throw failure
  if (!isCompleted) {
    if (signal?.aborted) return 'stopped'
    throw interrupted()
  }
  return 'completed'
}
