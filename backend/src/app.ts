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
import { createGuideService, guideRouter } from './api/guide/index.js'
import { createHealthService, healthRouter } from './api/health/index.js'
import { createProgressService, progressRouter } from './api/progress/index.js'
import { createQuizService, quizRouter } from './api/quiz/index.js'
import { createThreadModule, type ThreadApi } from './api/thread/index.js'
import { createTopicService, topicRouter, type TopicApi } from './api/topic/index.js'
import {
  createSessionService,
  createUserService,
  userRouter,
  warmDummyHash
} from './api/user/index.js'
import { createAiService, type AiApi } from './services/ai/index.js'
import { attachContext, type Limiters } from './context.js'
import { requireSession } from './middleware/auth.js'
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
  // Built once per app; the modules and the context share the same provider.
  const limiters: Limiters = {
    login: createLoginLimiter(pool),
    loginIp: createLoginIpLimiter(pool, config.loginIpRateLimit),
    signup: createSignupLimiter(pool, config.signupRateLimit)
  }
  const provider = tutor ?? createTutorProvider(config)
  // Modules are built in dependency order: a module only receives the APIs of modules built before it.
  const session = createSessionService({ db })
  // Computed at startup so the first unknown-email login is not ~2x slower.
  warmDummyHash()
  const user = createUserService({ db })
  const topic = createTopicService({ db })
  const ai = createAiService({ db, config, logger })
  const thread = createThreadModule({
    db,
    tutor: provider,
    logger,
    inFlight,
    requireSession,
    topic,
    ai
  })
  const guide = createGuideService({ db, tutor: provider, topic, ai, thread: thread.api })
  const quiz = createQuizService({ db, tutor: provider, topic, ai, thread: thread.api })
  const progress = createProgressService({ db })
  const health = createHealthService({ db })
  // Before any router: route handlers read their dependencies per request through ctxOf(req).
  attachContext(app, {
    config,
    db,
    logger,
    tutor: provider,
    inFlight,
    limiters,
    services: { ai, guide, health, progress, quiz, session, topic, user }
  })
  for (const router of [
    healthRouter,
    userRouter,
    topicRouter,
    thread.router,
    guideRouter,
    quizRouter,
    progressRouter
  ]) {
    app.use(router)
  }
  extraRoutes?.(app)
  app.use(notFoundHandler)
  app.use(errorMiddleware)
  return {
    app,
    modules: {
      topic,
      ai,
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
