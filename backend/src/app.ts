import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import type pg from 'pg'
import type { Config } from './lib/config.js'
import type { Db } from './lib/db/index.js'
import { InFlightRegistry } from './lib/in-flight.js'
import type { Logger } from './lib/logger.js'
import { createLoginIpLimiter, createLoginLimiter, createSignupLimiter } from './lib/rate-limit.js'
import { createTutorProvider } from './lib/tutor/factory.js'
import type { TutorProvider } from './lib/tutor/tutor.js'
import { createGuideModule } from './api/guide/index.js'
import { createHealthModule } from './api/health/index.js'
import { createProgressModule } from './api/progress/index.js'
import { createQuizModule } from './api/quiz/index.js'
import { createThreadModule, type ThreadApi } from './api/thread/index.js'
import { createAiModule, type AiApi } from './services/ai/index.js'
import { createTopicModule, type TopicApi } from './api/topic/index.js'
import { createUserModule } from './api/user/index.js'
import { attachContext, type Limiters } from './context.js'
import { errorMiddleware, notFoundHandler } from './middleware/error.js'
import { originCheck } from './middleware/origin-check.js'
import { requestId } from './middleware/request-id.js'

export type AppDeps = {
  config: Config
  db: Db
  /** The pool behind `db`; the rate limiters store their counters through it. */
  pool: pg.Pool
  logger: Logger
  /** Defaults to the provider selected by `config.aiProvider`; tests inject the fake. */
  tutor?: TutorProvider
  /** Test-only hook: mounts extra routes before the 404 and error handlers. */
  extraRoutes?: (app: Express) => void
  /** Running explain generations; the server aborts them all on shutdown. */
  inFlight?: InFlightRegistry
}

/** What index.ts and tests need besides HTTP: module APIs and the boot recovery. */
export type AppModules = {
  topic: TopicApi
  ai: AiApi
  thread: ThreadApi
  /**
   * Boot only, before the first request: fails every unfinished turn (whatever its age) and clears
   * every generation lock. Assumes a single backend instance, so all of it belongs to a dead
   * process. Turns first, then locks, so a freed user never meets their own orphan turn.
   */
  recoverAtBoot: () => Promise<{ turns: number; locks: number }>
}

export function createApp({
  config,
  db,
  pool,
  logger,
  tutor,
  extraRoutes,
  inFlight = new InFlightRegistry()
}: AppDeps): { app: Express; modules: AppModules } {
  const app = express()
  // An explicit hop count, never `true`: req.ip (and so the per-IP rate limits) must not be spoofable
  // through X-Forwarded-For, yet behind a proxy it must not collapse to the proxy's address.
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy)
  app.disable('x-powered-by')
  app.use(requestId)
  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) =>
        String((res.locals as Record<string, unknown> | undefined)?.requestId),
      serializers: {
        req: (req: { method: string; url: string; id: string }) => ({
          method: req.method,
          url: req.url.split('?')[0],
          requestId: req.id
        }),
        res: (res: { statusCode: number }) => ({ status: res.statusCode })
      }
    })
  )
  // API responses are JSON/SSE: helmet's defaults apply. The frontend (:3000) and API (:4000) are
  // same-site, so CORP stays same-site rather than helmet's same-origin default.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }))
  app.use(cors({ origin: config.frontendUrl, credentials: true }))
  app.use(cookieParser())
  app.use('/api', originCheck(config.frontendUrl))
  app.use(express.json({ limit: '256kb' }))
  // Built once per app: the module and the context share the same limiters and provider.
  const limiters: Limiters = {
    login: createLoginLimiter(pool),
    loginIp: createLoginIpLimiter(pool, config.loginIpRateLimit),
    signup: createSignupLimiter(pool, config.signupRateLimit)
  }
  const provider = tutor ?? createTutorProvider(config)
  // Modules are built in dependency order: a module only receives the APIs of modules built before it.
  const user = createUserModule({ db, config, limiters })
  const topic = createTopicModule({ db })
  const ai = createAiModule({ db, config, logger })
  const thread = createThreadModule({
    db,
    tutor: provider,
    logger,
    inFlight,
    requireSession: user.requireSession,
    topic: topic.api,
    ai: ai.api
  })
  const guide = createGuideModule({
    db,
    tutor: provider,
    requireSession: user.requireSession,
    topic: topic.api,
    ai: ai.api,
    thread: thread.api
  })
  const quiz = createQuizModule({
    db,
    tutor: provider,
    requireSession: user.requireSession,
    topic: topic.api,
    ai: ai.api,
    thread: thread.api
  })
  const progress = createProgressModule({ db, requireSession: user.requireSession })
  const health = createHealthModule({ db })
  // Before any router: route handlers read their dependencies per request through ctxOf(req).
  attachContext(app, { config, db, logger, tutor: provider, inFlight, limiters, services: {} })
  for (const router of [
    health.router,
    user.router,
    topic.router,
    thread.router,
    guide.router,
    quiz.router,
    progress.router
  ]) {
    app.use(router)
  }
  extraRoutes?.(app)
  app.use(notFoundHandler)
  app.use(errorMiddleware)
  return {
    app,
    modules: {
      topic: topic.api,
      ai: ai.api,
      thread: thread.api,
      recoverAtBoot: async () => {
        // A failed sweep must not leave users locked out: release the locks anyway, then let the
        // sweep's error propagate so index.ts logs it.
        let turns: number
        let locks: number
        try {
          turns = await thread.recoverStale()
        } finally {
          locks = await ai.releaseAllLocks()
        }
        return { turns, locks }
      }
    }
  }
}
