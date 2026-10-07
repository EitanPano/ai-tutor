import { createApp } from './app.js'
import { loadConfig } from './lib/config.js'
import { createDb } from './lib/db/index.js'
import { createLogger } from './lib/logger.js'

const SHUTDOWN_TIMEOUT_MS = 10_000

const config = loadConfig()
const logger = createLogger(config)
const { db, pool } = createDb(config.databaseUrl, logger)
const app = createApp({ config, db, pool, logger })

const server = app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port }, 'backend listening')
})

let shuttingDown = false

function shutdown(signal: string): void {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'shutting down')
  const force = setTimeout(() => {
    logger.error('shutdown timed out, forcing exit')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  force.unref()
  server.close(() => {
    // Kysely's destroy() ends the underlying pg pool.
    db.destroy()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        logger.error({ err }, 'error closing the database pool')
        process.exit(1)
      })
  })
  // Keep-alive connections would otherwise hold server.close() open until the timer fires.
  server.closeIdleConnections()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
