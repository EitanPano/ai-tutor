import type { CookieOptions, Response } from 'express'
import type { Config } from './config.js'
import { DAY_MS } from './time.js'

export const SESSION_COOKIE = 'sid'
export const SESSION_TTL_MS = 30 * DAY_MS
/** Absolute cap: a session never outlives its creation by more than this, however active. */
export const SESSION_MAX_AGE_MS = 90 * DAY_MS

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

/** Sets (or renews) the session cookie to `token`. */
export function setSessionCookie(
  res: Pick<Response, 'cookie'>,
  token: string,
  config: CookieConfig
): void {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(config))
}

/** Clears the session cookie with the attributes it was set with. */
export function clearSessionCookie(res: Pick<Response, 'clearCookie'>, config: CookieConfig): void {
  res.clearCookie(SESSION_COOKIE, clearSessionCookieOptions(config))
}
