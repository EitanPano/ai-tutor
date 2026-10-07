export type ApiErrorInit = {
  status: number
  code: string
  message: string
  details?: Record<string, unknown> | undefined
  requestId?: string | undefined
}

/** A non-2xx API response (or a network failure, status 0) in one throwable shape. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown> | undefined
  readonly requestId: string | undefined

  constructor({ status, code, message, details, requestId }: ApiErrorInit) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
  }
}

export const isApiError = (err: unknown): err is ApiError => err instanceof ApiError

const MESSAGE_BY_CODE: Record<string, string> = {
  network_error:
    "Can't reach the server. Make sure the API is running and you opened http://localhost:3000.",
  rate_limited: 'Too many attempts. Try again later.',
  unauthenticated: 'Your session ended. Log in again to continue.',
  invalid_credentials: 'Email or password is incorrect.',
  email_taken: 'An account with this email already exists. Log in instead.',
  validation_failed: 'Some fields need fixing. Check them and try again.',
  forbidden_origin:
    'The server refused this request. Reload the app from its usual address and try again.',
  not_found: "This thread doesn't exist or was deleted.",
  ai_budget_exceeded: "You've used today's AI budget. It resets at midnight in your time zone.",
  time_zone_recently_changed: 'You can change your time zone once a day. Try again later.',
  generation_in_progress: 'Another answer is still being generated. Wait for it to finish.',
  thread_full: 'This thread is full. Start a new thread to keep going.',
  ai_refused: "The tutor can't help with that question. Try rephrasing it.",
  ai_provider_error: 'The AI service failed to answer. Retry in a moment.',
  // Fallback only: `describeError` prefers the server's message, which tells a kill switch from a
  // paused-for-today cap.
  ai_unavailable: 'AI features are unavailable right now. Try again later.',
  thread_empty: 'Ask a question first. A guide or quiz needs an answer to build on.',
  attempt_incomplete: 'Answer every item before submitting.',
  ai_invalid_output: 'The tutor produced something unusable. Try again.',
  stream_interrupted: 'The answer stopped unexpectedly. Retry to ask again.'
}

const RETRYABLE_BY_KIND = {
  ask: new Set([
    'ai_provider_error',
    'stream_interrupted',
    'network_error',
    'generation_in_progress'
  ]),
  generate: new Set([
    'ai_invalid_output',
    'ai_provider_error',
    'generation_in_progress',
    'network_error'
  ])
} as const

/**
 * Whether a failure is worth a one-tap Retry: nothing about the request itself is wrong, so
 * asking again could work. `ask` streams an answer; `generate` writes a guide or a quiz.
 */
export function isRetryable(err: unknown, kind: keyof typeof RETRYABLE_BY_KIND): boolean {
  return isApiError(err) && RETRYABLE_BY_KIND[kind].has(err.code)
}

/** One user-facing sentence for any thrown value. Says what happened and what to do. */
export function describeError(err: unknown): string {
  if (isApiError(err)) {
    // Both causes share the code, and the server's message names the right one (and is safe to show).
    if (err.code === 'ai_unavailable' && err.message) return err.message
    const known = MESSAGE_BY_CODE[err.code]
    if (known) return known
    if (err.status >= 500) return 'The server hit a problem. Try again in a moment.'
    return err.message
  }
  return 'Something went wrong. Try again.'
}

/** Field-level messages from a `validation_failed` response, keyed by the first path segment. */
export function fieldIssues(err: unknown): Record<string, string> {
  if (!isApiError(err)) return {}
  const issues = err.details?.issues
  if (!Array.isArray(issues)) return {}
  const result: Record<string, string> = {}
  for (const issue of issues) {
    if (typeof issue !== 'object' || issue === null) continue
    const { path, message } = issue as { path?: unknown; message?: unknown }
    const field = Array.isArray(path) ? path[0] : undefined
    if (typeof field === 'string' && typeof message === 'string' && !(field in result)) {
      result[field] = message
    }
  }
  return result
}
