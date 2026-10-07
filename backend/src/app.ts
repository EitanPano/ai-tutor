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
import { guideRouter } from './feature/guide/index.js'
import { healthRouter } from './feature/health/index.js'
import { progressRouter } from './feature/progress/index.js'
import { quizRouter } from './feature/quiz/index.js'
import { threadRouter, messageRouter } from './feature/thread/index.js'
import { createTopicModule, type TopicApi } from './feature/topic/index.js'
import { userRouter, sessionRouter, warmDummyHash } from './feature/user/index.js'
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
export type AppModules = { topic: TopicApi }

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
  const topic = createTopicModule({ db })
  app.disable('x-powered-by')
  warmDummyHash()
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
  app.use(userRouter(db, config))
  app.use(sessionRouter(db, config, createLoginLimiter(pool)))
  app.use(topic.router)
  app.use(threadRouter(db, config, topic.api))
  const provider = tutor ?? createTutorProvider(config)
  app.use(messageRouter(db, config, provider, logger, inFlight, topic.api))
  app.use(guideRouter(db, config, provider, logger, topic.api))
  app.use(quizRouter(db, config, provider, logger, topic.api))
  app.use(progressRouter(db, config))
  extraRoutes?.(app)
  app.use(notFoundHandler)
  app.use(errorMiddleware)
  return { app, modules: { topic: topic.api } }
}
