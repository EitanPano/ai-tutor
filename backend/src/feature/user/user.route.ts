import { Router, type RequestHandler } from 'express'
import type { RateLimiterPostgres } from 'rate-limiter-flexible'
import type { Config } from '../../lib/config.js'
import { SESSION_COOKIE, sessionCookieOptions } from '../../lib/cookie.js'
import { consumeOrThrow, ipLimitKey } from '../../lib/rate-limit.js'
import type { UserService } from './user.service.js'
import { getAuth } from '../../http/get-auth.js'
import { signupSchema, updateSchema } from './user.schema.js'

export function userRouter(
  service: UserService,
  deps: {
    config: Pick<Config, 'nodeEnv'>
    signupLimiter: RateLimiterPostgres
    requireSession: RequestHandler
  }
): Router {
  const { config, signupLimiter, requireSession } = deps
  const router = Router()

  router.post('/api/user', async (req, res) => {
    // First, before parsing, hashing or any database work: every sign-up costs an argon2id hash.
    await consumeOrThrow(
      signupLimiter,
      ipLimitKey(req.ip ?? 'unknown'),
      res,
      'Too many sign-ups from this address. Try again later.'
    )
    const input = signupSchema.parse(req.body)
    const { user, token } = await service.create(input)
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(config))
    res.status(201).json({ user })
  })

  router.patch('/api/user', requireSession, async (req, res) => {
    const input = updateSchema.parse(req.body)
    const user = await service.update(getAuth(req), input)
    res.json({ user })
  })

  return router
}
