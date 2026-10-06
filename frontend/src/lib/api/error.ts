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
  network_error: "Can't reach the server. Check that the API is running, then retry.",
  rate_limited: 'Too many attempts. Wait a minute, then try again.',
  unauthenticated: 'Your session ended. Log in again to continue.',
  invalid_credentials: 'Email or password is incorrect.',
  email_taken: 'An account with this email already exists. Log in instead.',
  validation_failed: 'Some fields need fixing. Check them and try again.',
  forbidden: 'The server refused this request. Reload the page and try again.',
  not_found: "That item doesn't exist or was deleted.",
  upstream_unavailable: 'The AI provider is unavailable. Try again in a moment.'
}

/** One user-facing sentence for any thrown value. Says what happened and what to do. */
export function describeError(err: unknown): string {
  if (isApiError(err)) {
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
