import { randomUUID } from 'node:crypto'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type Express, type RequestHandler } from 'express'
import { pinoHttp } from 'pino-http'
import type pg from 'pg'
import type { Config } from './lib/config.js'
import type { Db } from './lib/db/index.js'
import { errorMiddleware, notFoundHandler } from './lib/error.js'
import type { Logger } from './lib/logger.js'
import { createLoginLimiter } from './lib/rate-limit.js'
import { createTutorProvider } from './lib/tutor/factory.js'
import type { TutorProvider } from './lib/tutor/tutor.js'
import { guideRouter } from './route/guide.route.js'
import { healthRouter } from './route/health.route.js'
import { progressRouter } from './route/progress.route.js'
import { quizRouter } from './route/quiz.route.js'
import { originCheck } from './route/middleware/origin-check.js'
import { messageRouter } from './route/message.route.js'
import { sessionRouter } from './route/session.route.js'
import { threadRouter } from './route/thread.route.js'
import { topicRouter } from './route/topic.route.js'
import { userRouter } from './route/user.route.js'
import { warmDummyHash } from './service/session.service.js'

const SANE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/

const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id')
  const id = incoming && SANE_REQUEST_ID.test(incoming) ? incoming : randomUUID()
  res.locals.requestId = id
  res.setHeader('X-Request-Id', id)
  next()
}

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
}

export function createApp({ config, db, pool, logger, tutor, extraRoutes }: AppDeps): Express {
  const app = express()
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
  app.use(cors({ origin: config.frontendUrl, credentials: true }))
  app.use(cookieParser())
  app.use('/api', originCheck(config.frontendUrl))
  app.use(express.json({ limit: '256kb' }))
  app.use(healthRouter(db))
  app.use(userRouter(db, config))
  app.use(sessionRouter(db, config, createLoginLimiter(pool)))
  app.use(topicRouter(db))
  app.use(threadRouter(db, config))
  const provider = tutor ?? createTutorProvider(config)
  app.use(messageRouter(db, config, provider, logger))
  app.use(guideRouter(db, config, provider, logger))
  app.use(quizRouter(db, config, provider, logger))
  app.use(progressRouter(db, config))
  extraRoutes?.(app)
  app.use(notFoundHandler)
  app.use(errorMiddleware)
  return app
}
