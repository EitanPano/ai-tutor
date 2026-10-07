import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import type pg from 'pg'
import type { Config } from './lib/config.js'
import type { Db } from './lib/db/index.js'
import { errorMiddleware, notFoundHandler } from './lib/error.js'
import { InFlightRegistry } from './lib/in-flight.js'
import type { Logger } from './lib/logger.js'
import { createLoginLimiter } from './lib/rate-limit.js'
import { createTutorProvider } from './lib/tutor/factory.js'
import type { TutorProvider } from './lib/tutor/tutor.js'
import { createGuideModule } from './feature/guide/index.js'
import { healthRouter } from './feature/health/index.js'
import { progressRouter } from './feature/progress/index.js'
import { createQuizModule } from './feature/quiz/index.js'
import { createThreadModule, type ThreadApi } from './feature/thread/index.js'
import { createAiModule, type AiApi } from './feature/ai/index.js'
import { createTopicModule, type TopicApi } from './feature/topic/index.js'
import { createUserModule } from './feature/user/index.js'
import { originCheck } from './http/origin-check.js'
import { requestId } from './http/request-id.js'

export type AppDeps = {
  config: Config
  db: Db
  /** The pool behind `db`; the login limiter stores its counters through it. */
  pool: pg.Pool
  logger: Logger
  /** Defaults to the provider selected by `config.aiProvider`; tests inject the fake. */
  tutor?: TutorProvider
  /** Test-only hook: mounts extra routes before the 404 and error handlers. */
  extraRoutes?: (app: Express) => void
  /** Running explain generations; the server aborts them all on shutdown. */
  inFlight?: InFlightRegistry
}

/** The module APIs used outside HTTP: boot recovery in index.ts, and tests. Grows per module. */
export type AppModules = { topic: TopicApi; ai: AiApi; thread: ThreadApi }

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
  const user = createUserModule({ db, config, loginLimiter: createLoginLimiter(pool) })
  const topic = createTopicModule({ db })
  const ai = createAiModule({ db, config, logger })
  const provider = tutor ?? createTutorProvider(config)
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
  app.use(healthRouter(db))
  app.use(user.router)
  app.use(topic.router)
  app.use(thread.router)
  app.use(guide.router)
  app.use(quiz.router)
  app.use(progressRouter(db, user.requireSession))
  extraRoutes?.(app)
  app.use(notFoundHandler)
  app.use(errorMiddleware)
  return { app, modules: { topic: topic.api, ai: ai.api, thread: thread.api } }
}
