import type { CookieOptions } from 'express'
import type { Config } from './config.js'

export const SESSION_COOKIE = 'sid'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function sessionCookieOptions(config: Pick<Config, 'nodeEnv'>): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS
  }
}

/** Options for res.clearCookie: same attributes as the cookie, without maxAge. */
export function clearSessionCookieOptions(config: Pick<Config, 'nodeEnv'>): CookieOptions {
  const options = sessionCookieOptions(config)
  delete options.maxAge
  return options
}
