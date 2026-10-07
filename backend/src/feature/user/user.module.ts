import { Router, type RequestHandler } from 'express'
import type { Config } from '../../lib/config.js'
import type { Db } from '../../lib/db/index.js'
import type { UserLimiters } from '../../lib/rate-limit.js'
import { requireSession as buildRequireSession } from './require-session.js'
import { createSessionService, warmDummyHash } from './session.service.js'
import { sessionRouter } from './session.route.js'
import { createUserService } from './user.service.js'
import { userRouter } from './user.route.js'

export type UserModuleDeps = {
  db: Db
  config: Pick<Config, 'nodeEnv'>
  /** Postgres-backed limiters for sign-up and login. */
  limiters: UserLimiters
}

/** Builds the user and session services, one shared requireSession middleware, and their routes. */
export function createUserModule({ db, config, limiters }: UserModuleDeps): {
  router: Router
  requireSession: RequestHandler
} {
  // Computed at startup so the first unknown-email login is not ~2x slower.
  warmDummyHash()
  const user = createUserService({ db })
  const session = createSessionService({ db })
  const requireSession = buildRequireSession(session, config)
  const router = Router().use(
    userRouter(user, { config, signupLimiter: limiters.signup, requireSession }),
    sessionRouter(session, { user, config, limiters, requireSession })
  )
  return { router, requireSession }
}
