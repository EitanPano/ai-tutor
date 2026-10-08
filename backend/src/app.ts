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
import { createMessageService, createThreadService, threadRouter } from './api/thread/index.js'
import { createTopicService, topicRouter } from './api/topic/index.js'
import {
  createSessionService,
  createUserService,
  userRouter,
  warmDummyHash
} from './api/user/index.js'
import { createAiService } from './services/ai/index.js'
import { attachContext, type AppContext } from './context.js'
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

/**
 * Boot only, before the first request: fails every unfinished turn (whatever its age) and clears
 * every generation lock. Assumes a single backend instance, so all of it belongs to a dead
 * process. Turns first, then locks, so a freed user never meets their own orphan turn.
 */
export type RecoverAtBoot = () => Promise<{ turns: number; locks: number }>

export function createApp({
  config,
  db,
  pool,
  logger,
  tutor,
  extraRoutes,
  inFlight = new InFlightRegistry()
}: AppDeps): { app: Express; ctx: AppContext; recoverAtBoot: RecoverAtBoot } {
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
  const provider = tutor ?? createTutorProvider(config)
  // Health and progress stand alone: they neither use nor are used by other services.
  const health = createHealthService({ db })
  const progress = createProgressService({ db })
  // The rest are built in dependency order: a service only receives the APIs of services built
  // before it.
  const user = createUserService({ db })
  const session = createSessionService({ db })
  // Computed at startup so the first unknown-email login is not ~2x slower.
  warmDummyHash()
  const topic = createTopicService({ db })
  const ai = createAiService({ db, config, logger })
  const thread = createThreadService({ db, topic, ai })
  const message = createMessageService({ db, tutor: provider, topic, ai, thread, logger })
  const guide = createGuideService({ db, tutor: provider, topic, ai, thread })
  const quiz = createQuizService({ db, tutor: provider, topic, ai, thread })
  const ctx: AppContext = {
    config,
    db,
    logger,
    tutor: provider,
    inFlight,
    limiters: {
      login: createLoginLimiter(pool),
      loginIp: createLoginIpLimiter(pool, config.loginIpRateLimit),
      signup: createSignupLimiter(pool, config.signupRateLimit)
    },
    services: { ai, guide, health, message, progress, quiz, session, thread, topic, user }
  }
  // Before any router: route handlers read their dependencies per request through ctxOf(req).
  attachContext(app, ctx)
  for (const router of [
    healthRouter,
    userRouter,
    topicRouter,
    threadRouter,
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
    ctx,
    recoverAtBoot: async () => {
      // A failed sweep must not leave users locked out: release the locks anyway, then let the
      // sweep's error propagate so index.ts logs it.
      let turns: number
      let locks: number
      try {
        turns = await thread.recoverStaleAtBoot()
      } finally {
        locks = await ai.releaseAllLocks()
      }
      return { turns, locks }
    }
  }
}
