import type { RequestHandler } from 'express'
import type { Config } from '../../lib/config.js'
import {
  clearSessionCookieOptions,
  SESSION_COOKIE,
  sessionCookieOptions
} from '../../lib/cookie.js'
import type { Db } from '../../lib/db/index.js'
import { unauthorized } from '../../lib/error.js'
import { extendSession, resolveSession, slidingExpiry } from './session.service.js'

const DAY_MS = 24 * 60 * 60 * 1000

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
    // Extend only once the session could gain a day, so it is written at most daily. Near the
    // absolute cap the target stops moving, so it stops being written too.
    if (slidingExpiry(session.createdAt).getTime() - session.expiresAt.getTime() > DAY_MS) {
      await extendSession(db, session.sessionId, session.createdAt)
      res.cookie(SESSION_COOKIE, token, sessionCookieOptions(config))
    }
    req.auth = { userId: session.userId }
    next()
  }
}
