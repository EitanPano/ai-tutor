import type { Express, Request } from 'express'
import type { Config } from './lib/config.js'
import type { Db } from './lib/db/index.js'
import type { InFlightRegistry } from './lib/in-flight.js'
import type { Logger } from './lib/logger.js'
import type { UserLimiters } from './lib/rate-limit.js'
import type { TutorProvider } from './lib/tutor/tutor.js'
import type { GuideService } from './api/guide/index.js'
import type { HealthService } from './api/health/index.js'
import type { ProgressService } from './api/progress/index.js'
import type { QuizService } from './api/quiz/index.js'
import type { MessageService, ThreadService } from './api/thread/index.js'
import type { TopicService } from './api/topic/index.js'
import type { SessionService, UserService } from './api/user/index.js'
import type { AiService } from './services/ai/index.js'

/** The Postgres-backed rate limiters, built once per app. */
export type Limiters = UserLimiters

/** The services `createApp` builds, by name; controllers read them through `servicesOf(req)`. */
export type Services = {
  ai: AiService
  guide: GuideService
  health: HealthService
  message: MessageService
  progress: ProgressService
  quiz: QuizService
  session: SessionService
  thread: ThreadService
  topic: TopicService
  user: UserService
}

/** Everything a request handler depends on, built once per app by `createApp`. */
export type AppContext = {
  config: Config
  db: Db
  logger: Logger
  tutor: TutorProvider
  /** Running explain generations; the server aborts them all on shutdown. */
  inFlight: InFlightRegistry
  limiters: Limiters
  services: Services
}

// Stored on the app, not in a module-level variable: several apps with different config share one
// test worker. `Express.Locals` is not augmented, since that would also type `res.locals.ctx`.
const CONTEXT_KEY = 'ctx'

export function attachContext(app: Pick<Express, 'locals'>, ctx: AppContext): void {
  ;(app.locals as Record<string, unknown>)[CONTEXT_KEY] = ctx
}

/** The context of the app serving `req`. Throws when the app was built without one. */
export function ctxOf(req: Pick<Request, 'app'>): AppContext {
  const ctx = (req.app.locals as Record<string, unknown>)[CONTEXT_KEY]
  if (ctx === undefined)
    throw new Error('AppContext missing: createApp() must call attachContext()')
  return ctx as AppContext
}

export function servicesOf(req: Pick<Request, 'app'>): Services {
  return ctxOf(req).services
}
