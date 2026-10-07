import { describe, expect, it } from 'vitest'
import {
  clearSessionCookieOptions,
  SESSION_COOKIE,
  sessionCookieOptions
} from '../../src/lib/cookie.js'

const HTTP = 'http://localhost:3000'
const HTTPS = 'https://tutor.example.com'

describe('sessionCookieOptions', () => {
  it('names the cookie sid', () => {
    expect(SESSION_COOKIE).toBe('sid')
  })

  it.each([
    ['production', HTTP, true],
    ['production', HTTPS, true],
    ['development', HTTP, false],
    ['development', HTTPS, true],
    ['test', HTTP, false],
    ['test', HTTPS, true]
  ] as const)('sets secure for %s + %s -> %s', (nodeEnv, frontendUrl, secure) => {
    expect(sessionCookieOptions({ nodeEnv, frontendUrl }).secure).toBe(secure)
  })

  it('parses the URL instead of matching a prefix', () => {
    const frontendUrl = 'http://https.example.com'
    expect(sessionCookieOptions({ nodeEnv: 'development', frontendUrl }).secure).toBe(false)
  })

  it('is httpOnly, lax, site-wide and lasts 30 days', () => {
    expect(sessionCookieOptions({ nodeEnv: 'test', frontendUrl: HTTP })).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000
    })
  })

  it('clears with the same attributes minus maxAge', () => {
    const options = clearSessionCookieOptions({ nodeEnv: 'production', frontendUrl: HTTP })
    expect(options).toEqual({ httpOnly: true, sameSite: 'lax', secure: true, path: '/' })
  })

  it('carries the same secure value when clearing', () => {
    const https = clearSessionCookieOptions({ nodeEnv: 'development', frontendUrl: HTTPS })
    const http = clearSessionCookieOptions({ nodeEnv: 'development', frontendUrl: HTTP })
    expect(https.secure).toBe(true)
    expect(http.secure).toBe(false)
  })
})
