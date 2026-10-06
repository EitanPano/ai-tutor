import type { RequestHandler } from 'express'
import type { Config } from '../../lib/config.js'
import {
  clearSessionCookieOptions,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sessionCookieOptions
} from '../../lib/cookie.js'
import type { Db } from '../../lib/db/index.js'
import { unauthorized } from '../../lib/error.js'
import { extendSession, resolveSession } from '../../service/session.service.js'

const DAY_MS = 24 * 60 * 60 * 1000
// Extend only once the session has lost a day of its 30, so a session is written at most daily.
const EXTEND_BELOW_MS = SESSION_TTL_MS - DAY_MS

export function readSessionToken(cookies: unknown): string | undefined {
  const value = (cookies as Record<string, unknown> | undefined)?.[SESSION_COOKIE]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Resolves the `sid` cookie to `req.auth`, slides the expiry, or answers 401 `unauthenticated`. */
export function requireSession(db: Db, config: Pick<Config, 'nodeEnv'>): RequestHandler {
  return async (req, res, next) => {
    const token = readSessionToken(req.cookies)
    const session = token ? await resolveSession(db, token) : undefined
    if (!token || !session) {
      // A stale cookie must not linger: the frontend redirects on cookie presence alone.
      if (token) res.clearCookie(SESSION_COOKIE, clearSessionCookieOptions(config))
      throw unauthorized('Sign in to continue.', 'unauthenticated')
    }
    if (session.expiresAt.getTime() - Date.now() < EXTEND_BELOW_MS) {
      await extendSession(db, session.sessionId)
      res.cookie(SESSION_COOKIE, token, sessionCookieOptions(config))
    }
    req.auth = { userId: session.userId }
    next()
  }
}
