// @vitest-environment node
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { proxy } from '@/proxy'

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : undefined)

const location = (response: Response) => response.headers.get('location')

describe('proxy', () => {
  it.each(['/thread', '/thread/abc', '/guide/1', '/quiz/2', '/progress'])(
    'redirects %s to /login with next when there is no sid cookie',
    (path) => {
      const response = proxy(request(path))
      expect(response.status).toBe(307)
      expect(location(response)).toBe(
        `http://localhost:3000/login?next=${encodeURIComponent(path)}`
      )
    }
  )

  it('keeps the query string in next', () => {
    const response = proxy(request('/thread/abc?x=1'))
    expect(location(response)).toBe(
      `http://localhost:3000/login?next=${encodeURIComponent('/thread/abc?x=1')}`
    )
  })

  it('lets a protected path through with a sid cookie', () => {
    const response = proxy(request('/thread', 'sid=abc'))
    expect(location(response)).toBeNull()
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('never redirects /login or /signup, even with a sid cookie', () => {
    for (const path of ['/login', '/signup']) {
      expect(location(proxy(request(path, 'sid=stale')))).toBeNull()
      expect(location(proxy(request(path)))).toBeNull()
    }
  })

  it('does not treat lookalike paths as protected', () => {
    expect(location(proxy(request('/threads-info')))).toBeNull()
  })

  it('sends / to /thread with a sid cookie and to /login without', () => {
    expect(location(proxy(request('/', 'sid=abc')))).toBe('http://localhost:3000/thread')
    expect(location(proxy(request('/')))).toBe('http://localhost:3000/login')
  })
})

describe('proxy CSP', () => {
  const csp = (response: Response) => response.headers.get('content-security-policy') ?? ''
  const nonceOf = (value: string) => /'nonce-([^']+)'/.exec(value)?.[1]

  it('sets a CSP with a nonce on a page response', () => {
    const response = proxy(request('/login'))
    expect(csp(response)).toContain("script-src 'self' 'nonce-")
    expect(csp(response)).toContain("frame-ancestors 'none'")
  })

  it('uses a different nonce for every request', () => {
    expect(nonceOf(csp(proxy(request('/login'))))).not.toBe(nonceOf(csp(proxy(request('/login')))))
  })

  it('forwards the same policy to the renderer so Next can stamp the nonce', () => {
    const response = proxy(request('/thread', 'sid=abc'))
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(csp(response))
  })
})
