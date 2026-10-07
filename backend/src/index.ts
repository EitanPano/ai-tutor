import { createApp } from './app.js'
import { loadConfig } from './lib/config.js'
import { createDb } from './lib/db/index.js'
import { InFlightRegistry } from './lib/in-flight.js'
import { createLogger } from './lib/logger.js'
import { recoverStaleTurn } from './feature/thread/index.js'

const SHUTDOWN_TIMEOUT_MS = 10_000

const config = loadConfig()
const logger = createLogger(config)
const { db, pool } = createDb(config.databaseUrl, logger)
const inFlight = new InFlightRegistry()
const app = createApp({ config, db, pool, logger, inFlight })

// A single instance runs, so a turn left in flight by a crash is recovered once at boot.
if (config.recoverStaleOnBoot) {
  recoverStaleTurn(db)
    .then((count) => {
      if (count > 0) logger.warn({ count }, 'recovered turns left in flight by a previous run')
    })
    .catch((err: unknown) => logger.error({ err }, 'recovering stale turns failed'))
}

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
  // Abort running generations first: each one persists `aborted` and releases its lock through
  // finishAsk, which ends its SSE response, so server.close() below can complete.
  const aborted = inFlight.abortAll()
  if (aborted > 0) logger.info({ aborted }, 'aborted in-flight generations')
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
