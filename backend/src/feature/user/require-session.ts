import type { RequestHandler } from 'express'
import type { Config } from '../../lib/config.js'
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from '../../lib/cookie.js'
import { unauthenticated } from '../../lib/error.js'
import { slidingExpiry, type SessionService } from './session.service.js'

const DAY_MS = 24 * 60 * 60 * 1000

export function readSessionToken(cookies: unknown): string | undefined {
  const value = (cookies as Record<string, unknown> | undefined)?.[SESSION_COOKIE]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Resolves the `sid` cookie to `req.auth`, slides the expiry, or answers 401 `unauthenticated`. */
export function requireSession(
  session: SessionService,
  config: Pick<Config, 'nodeEnv' | 'frontendUrl'>
): RequestHandler {
  return async (req, res, next) => {
    const token = readSessionToken(req.cookies)
    const resolved = token ? await session.resolve(token) : undefined
    if (!token || !resolved) {
      // A stale cookie must not linger: the frontend redirects on cookie presence alone.
      if (token) clearSessionCookie(res, config)
      throw unauthenticated()
    }
    // Extend only once the session could gain a day, so it is written at most daily. Near the
    // absolute cap the target stops moving, so it stops being written too.
    if (slidingExpiry(resolved.createdAt).getTime() - resolved.expiresAt.getTime() > DAY_MS) {
      await session.extend(resolved.sessionId, resolved.createdAt)
      setSessionCookie(res, token, config)
    }
    req.auth = { userId: resolved.userId }
    next()
  }
}
