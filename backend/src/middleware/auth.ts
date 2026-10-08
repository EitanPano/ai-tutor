import type { Request } from 'express'
import { ctxOf, servicesOf } from '../context.js'
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from '../lib/cookie.js'
import { unauthenticated } from '../lib/error.js'
import type { Auth } from '../lib/ownership.js'
import type { Middleware } from './validate.js'

/** The `sid` cookie's value, or undefined when it is missing or empty. */
export function readSessionToken(cookies: unknown): string | undefined {
  const value = (cookies as Record<string, unknown> | undefined)?.[SESSION_COOKIE]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Resolves the `sid` cookie to `req.auth`, or answers 401 `unauthenticated`. Re-sends the cookie
 * when the session service slid the expiry. The service is looked up per request, on the app's
 * context.
 */
export const requireSession: Middleware = async (req, res, next) => {
  const { config } = ctxOf(req)
  const token = readSessionToken(req.cookies)
  const session = token ? await servicesOf(req).session.authenticate(token) : undefined
  if (!token || !session) {
    // A stale cookie must not linger: the frontend redirects on cookie presence alone.
    if (token) clearSessionCookie(res, config)
    throw unauthenticated()
  }
  if (session.isExtended) setSessionCookie(res, token, config)
  req.auth = { userId: session.userId }
  next()
}

/** The signed-in user for this request. Routes pass this object to services explicitly. */
export function getAuth(req: Pick<Request, 'auth'>): Auth {
  if (!req.auth) throw unauthenticated()
  return { userId: req.auth.userId }
}
