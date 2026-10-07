import { describe, expect, it } from 'vitest'
import {
  clearSessionCookieOptions,
  SESSION_COOKIE,
  sessionCookieOptions
} from '../../src/lib/cookie.js'

describe('sessionCookieOptions', () => {
  it('names the cookie sid', () => {
    expect(SESSION_COOKIE).toBe('sid')
  })

  it.each([
    ['production', true],
    ['development', false],
    ['test', false]
  ] as const)('sets secure=%s -> %s', (nodeEnv, secure) => {
    expect(sessionCookieOptions({ nodeEnv }).secure).toBe(secure)
  })

  it('is httpOnly, lax, site-wide and lasts 30 days', () => {
    expect(sessionCookieOptions({ nodeEnv: 'test' })).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000
    })
  })

  it('clears with the same attributes minus maxAge', () => {
    const options = clearSessionCookieOptions({ nodeEnv: 'production' })
    expect(options).toEqual({ httpOnly: true, sameSite: 'lax', secure: true, path: '/' })
  })
})
