import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '@/lib/api/client'
import { ApiError, describeError, fieldIssues } from '@/lib/api/error'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiFetch', () => {
  it('sends credentials and JSON headers and returns the parsed body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { user: { id: 'u1' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await apiFetch<{ user: { id: string } }>('/api/session', {
      method: 'POST',
      body: { email: 'a@b.co' }
    })

    expect(result).toEqual({ user: { id: 'u1' } })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:4000/api/session')
    expect(init.credentials).toBe('include')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(init.body).toBe('{"email":"a@b.co"}')
  })

  it('does not set a content type on a bodiless request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    await apiFetch('/api/session')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(init.headers).not.toHaveProperty('Content-Type')
  })

  it('resolves 204 to undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    await expect(apiFetch('/api/session', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('parses an ErrorResponse into an ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(400, {
          error: {
            code: 'validation_failed',
            message: 'The request is invalid.',
            details: { issues: [{ path: ['email'], message: 'Invalid email address' }] }
          },
          requestId: 'req-1'
        })
      )
    )

    const err = await apiFetch('/api/user', { method: 'POST', body: {} }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({
      status: 400,
      code: 'validation_failed',
      message: 'The request is invalid.',
      requestId: 'req-1'
    })
    expect(fieldIssues(err)).toEqual({ email: 'Invalid email address' })
  })

  it('turns a non-JSON error body into an ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 502 })))
    const err = await apiFetch('/api/session').catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 502, code: 'unexpected_response' })
  })

  it('turns a network failure into a network_error ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const err = await apiFetch('/api/session').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 0, code: 'network_error' })
    expect(describeError(err)).toBe(
      "Can't reach the server. Make sure the API is running and you opened http://localhost:3000."
    )
  })
})

describe('describeError', () => {
  it('explains a foreign-origin refusal (forbidden_origin)', () => {
    const err = new ApiError({ status: 403, code: 'forbidden_origin', message: 'x' })
    expect(describeError(err)).toBe(
      'The server refused this request. Reload the app from its usual address and try again.'
    )
  })

  it('has a sentence for rate limiting', () => {
    const err = new ApiError({ status: 429, code: 'rate_limited', message: 'x' })
    expect(describeError(err)).toBe('Too many attempts. Wait a minute, then try again.')
  })

  it('does not leak a server message for 5xx errors', () => {
    const err = new ApiError({ status: 500, code: 'internal_error', message: 'boom' })
    expect(describeError(err)).toBe('The server hit a problem. Try again in a moment.')
  })

  it('handles values that are not ApiErrors', () => {
    expect(describeError(new Error('x'))).toBe('Something went wrong. Try again.')
  })
})
