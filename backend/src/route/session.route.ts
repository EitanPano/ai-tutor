import { Router } from 'express'
import { RateLimiterRes, type RateLimiterPostgres } from 'rate-limiter-flexible'
import { z } from 'zod'
import type { Config } from '../lib/config.js'
import { clearSessionCookieOptions, SESSION_COOKIE, sessionCookieOptions } from '../lib/cookie.js'
import type { Db } from '../lib/db/index.js'
import { tooManyRequests, unauthorized } from '../lib/error.js'
import { loginLimitKey } from '../lib/rate-limit.js'
import { login, logout } from '../service/session.service.js'
import { getAuth } from './middleware/get-auth.js'
import { readSessionToken, requireSession } from './middleware/require-session.js'
import { getUser } from '../service/user.service.js'

// Mirrors LoginRequest in .orchestrate/api-contract.yaml.
const loginSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(128)
})

export function sessionRouter(db: Db, config: Config, loginLimiter: RateLimiterPostgres): Router {
  const router = Router()

  router.post('/api/session', async (req, res) => {
    const input = loginSchema.parse(req.body)
    try {
      await loginLimiter.consume(loginLimitKey(req.ip ?? 'unknown', input.email))
    } catch (err) {
      if (!(err instanceof RateLimiterRes)) throw err
      const retryAfter = Math.max(1, Math.ceil(err.msBeforeNext / 1000))
      res.set('Retry-After', String(retryAfter))
      throw tooManyRequests('Too many login attempts. Try again shortly.')
    }
    const { user, token } = await login(db, input, readSessionToken(req.cookies))
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(config))
    res.json({ user })
  })

  router.get('/api/session', requireSession(db, config), async (req, res) => {
    const user = await getUser(db, getAuth(req))
    res.json({ user })
  })

  router.delete('/api/session', requireSession(db, config), async (req, res) => {
    const token = readSessionToken(req.cookies)
    if (!token) throw unauthorized('Sign in to continue.', 'unauthenticated')
    await logout(db, token)
    res.clearCookie(SESSION_COOKIE, clearSessionCookieOptions(config))
    res.status(204).end()
  })

  return router
}
