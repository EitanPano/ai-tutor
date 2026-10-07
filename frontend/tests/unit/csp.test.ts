import { describe, expect, it } from 'vitest'
import { buildCsp, newNonce } from '@/lib/csp'

const base = { nonce: 'abc123', apiUrl: 'http://localhost:4000' }

describe('buildCsp', () => {
  it('builds the production policy with the nonce, strict-dynamic and the API origin', () => {
    const csp = buildCsp({ ...base, isDev: false })
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'; ")
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).toContain("img-src 'self' data: blob:")
    expect(csp).toContain("connect-src 'self' http://localhost:4000;")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
  })

  it('allows eval in development only, and never WebAssembly compilation', () => {
    expect(buildCsp({ ...base, isDev: true })).toContain("'strict-dynamic' 'unsafe-eval';")
    const prod = buildCsp({ ...base, isDev: false })
    expect(prod).not.toContain('unsafe-eval')
    expect(prod).not.toContain('wasm-unsafe-eval')
  })

  it('reduces the API URL to its origin', () => {
    expect(buildCsp({ ...base, apiUrl: 'https://api.example.com/v1', isDev: false })).toContain(
      "connect-src 'self' https://api.example.com;"
    )
  })
})

describe('newNonce', () => {
  it('is base64 and different every time', () => {
    const a = newNonce()
    expect(a).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(newNonce()).not.toBe(a)
  })
})
