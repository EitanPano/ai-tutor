import type { components } from '@/types/api'
import { ApiError } from './error'

export type ErrorResponse = components['schemas']['ErrorResponse']

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

/** A cache seeded with `setQueryData` just before navigating is fresh for this long, so the next page uses it as is. */
export const SEEDED_STALE_MS = 30_000

type ApiFetchOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal | undefined
}

export function isErrorResponse(value: unknown): value is ErrorResponse {
  if (typeof value !== 'object' || value === null) return false
  const error = (value as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  return typeof code === 'string' && typeof message === 'string'
}

export async function toApiError(response: Response): Promise<ApiError> {
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    parsed = undefined
  }
  if (isErrorResponse(parsed)) {
    return new ApiError({
      status: response.status,
      code: parsed.error.code,
      message: parsed.error.message,
      details: parsed.error.details,
      requestId: parsed.requestId
    })
  }
  return new ApiError({
    status: response.status,
    code: 'unexpected_response',
    message: `The server answered ${response.status} without an error body.`
  })
}

/** Calls the backend with the session cookie. 204 resolves to `undefined`; non-2xx throws `ApiError`. */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      ...(body !== undefined && { body: JSON.stringify(body) }),
      ...(signal && { signal })
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError({
      status: 0,
      code: 'network_error',
      message: 'The request did not reach the server.'
    })
  }

  if (!response.ok) throw await toApiError(response)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
