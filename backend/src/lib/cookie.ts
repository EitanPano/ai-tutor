import type { CookieOptions } from 'express'
import type { Config } from './config.js'

export const SESSION_COOKIE = 'sid'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Absolute cap: a session never outlives its creation by more than this, however active. */
export const SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

type CookieConfig = Pick<Config, 'nodeEnv' | 'frontendUrl'>

/** Secure when the site is served over https (so a forgotten NODE_ENV cannot leak the cookie) or in production. */
function isSecure(config: CookieConfig): boolean {
  return config.nodeEnv === 'production' || new URL(config.frontendUrl).protocol === 'https:'
}

export function sessionCookieOptions(config: CookieConfig): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(config),
    path: '/',
    maxAge: SESSION_TTL_MS
  }
}

/** Options for res.clearCookie: same attributes as the cookie, without maxAge. */
export function clearSessionCookieOptions(config: CookieConfig): CookieOptions {
  const options = sessionCookieOptions(config)
  delete options.maxAge
  return options
}
