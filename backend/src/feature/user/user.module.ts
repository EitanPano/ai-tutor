import { Router, type RequestHandler } from 'express'
import type { RateLimiterPostgres } from 'rate-limiter-flexible'
import type { Config } from '../../lib/config.js'
import type { Db } from '../../lib/db/index.js'
import { requireSession as buildRequireSession } from './require-session.js'
import { createSessionService, warmDummyHash } from './session.service.js'
import { sessionRouter } from './session.route.js'
import { createUserService } from './user.service.js'
import { userRouter } from './user.route.js'

export type UserModuleDeps = {
  db: Db
  config: Pick<Config, 'nodeEnv'>
  /** Postgres-backed login limiter (5/min per ip + email). */
  loginLimiter: RateLimiterPostgres
}

/** Builds the user and session services, one shared requireSession middleware, and their routes. */
export function createUserModule({ db, config, loginLimiter }: UserModuleDeps): {
  router: Router
  requireSession: RequestHandler
} {
  // Computed at startup so the first unknown-email login is not ~2x slower.
  warmDummyHash()
  const user = createUserService({ db })
  const session = createSessionService({ db })
  const requireSession = buildRequireSession(session, config)
  const router = Router().use(
    userRouter(user, { config, requireSession }),
    sessionRouter(session, { user, config, loginLimiter, requireSession })
  )
  return { router, requireSession }
}
