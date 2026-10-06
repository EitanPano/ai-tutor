import { randomUUID } from 'node:crypto'
import cors from 'cors'
import express, { type Express, type RequestHandler } from 'express'
import { pinoHttp } from 'pino-http'
import type { Config } from './lib/config.js'
import type { Db } from './lib/db/index.js'
import { errorMiddleware, notFoundHandler } from './lib/error.js'
import type { Logger } from './lib/logger.js'
import { healthRouter } from './route/health.route.js'

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
  logger: Logger
  /** Test-only hook: mounts extra routes before the 404 and error handlers. */
  extraRoutes?: (app: Express) => void
}

export function createApp({ config, db, logger, extraRoutes }: AppDeps): Express {
  const app = express()
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
          url: req.url,
          requestId: req.id
        }),
        res: (res: { statusCode: number }) => ({ status: res.statusCode })
      }
    })
  )
  app.use(cors({ origin: config.frontendUrl, credentials: true }))
  app.use(express.json({ limit: '256kb' }))
  app.use(healthRouter(db))
  extraRoutes?.(app)
  app.use(notFoundHandler)
  app.use(errorMiddleware)
  return app
}
