import express, { type Express } from 'express'
import { pinoHttp } from 'pino-http'
import { createLogger } from '../../src/lib/logger.js'
import { errorMiddleware, notFoundHandler } from '../../src/middleware/error.js'
import { stopServer } from './client.js'

const built: Express[] = []

/**
 * A bare Express app for middleware unit tests: a silent request logger and JSON body parsing in
 * front of `mount`, then the API's 404 and error handlers. No database, no modules, no context.
 */
export function createBareApp(mount: (app: Express) => void): Express {
  const app = express()
  app.use(pinoHttp({ logger: createLogger({ nodeEnv: 'test', logLevel: 'silent' }) }))
  app.use(express.json())
  mount(app)
  app.use(notFoundHandler)
  app.use(errorMiddleware)
  built.push(app)
  return app
}

/** Closes the shared test server of every bare app built so far. Call it in `afterEach`. */
export async function stopBareApps(): Promise<void> {
  await Promise.all(built.splice(0).map((app) => stopServer(app)))
}
