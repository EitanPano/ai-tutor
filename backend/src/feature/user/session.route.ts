import { Router, type RequestHandler } from 'express'
import type { Config } from '../../lib/config.js'
import {
  clearSessionCookieOptions,
  SESSION_COOKIE,
  sessionCookieOptions
} from '../../lib/cookie.js'
import { unauthorized } from '../../lib/error.js'
import {
  consumeOrThrow,
  ipLimitKey,
  loginLimitKey,
  type UserLimiters
} from '../../lib/rate-limit.js'
import type { SessionService } from './session.service.js'
import { getAuth } from '../../http/get-auth.js'
import { readSessionToken } from './require-session.js'
import type { UserService } from './user.service.js'
import { loginSchema } from './session.schema.js'

export function sessionRouter(
  service: SessionService,
  deps: {
    user: UserService
    config: Pick<Config, 'nodeEnv'>
    limiters: Pick<UserLimiters, 'login' | 'loginIp'>
    requireSession: RequestHandler
  }
): Router {
  const { user: userService, config, limiters, requireSession } = deps
  const router = Router()

  router.post('/api/session', async (req, res) => {
    const input = loginSchema.parse(req.body)
    const ip = req.ip ?? 'unknown'
    const message = 'Too many login attempts. Try again shortly.'
    // The per-IP limit first, so a flood of fresh emails never reaches the argon2 verify.
    await consumeOrThrow(limiters.loginIp, ipLimitKey(ip), res, message)
    await consumeOrThrow(limiters.login, loginLimitKey(ip, input.email), res, message)
    const { user, token } = await service.login(input, readSessionToken(req.cookies))
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(config))
    res.json({ user })
  })

  router.get('/api/session', requireSession, async (req, res) => {
    const user = await userService.get(getAuth(req))
    res.json({ user })
  })

  router.delete('/api/session', requireSession, async (req, res) => {
    const token = readSessionToken(req.cookies)
    if (!token) throw unauthorized('Sign in to continue.', 'unauthenticated')
    await service.logout(token)
    res.clearCookie(SESSION_COOKIE, clearSessionCookieOptions(config))
    res.status(204).end()
  })

  return router
}
