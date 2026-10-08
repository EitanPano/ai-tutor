import { createApp } from './app.js'
import { configWarning, loadConfig } from './lib/config.js'
import { createDb } from './lib/db/index.js'
import { InFlightRegistry } from './lib/in-flight.js'
import { createLogger } from './lib/logger.js'

const SHUTDOWN_TIMEOUT_MS = 10_000

const config = loadConfig()
const logger = createLogger(config)
const warning = configWarning(config)
if (warning) logger.warn(warning)
const { db, pool } = createDb(config.databaseUrl, logger)
const inFlight = new InFlightRegistry()
const { app, recoverAtBoot } = createApp({ config, db, pool, logger, inFlight })

// A single instance runs, so every turn and lock left by a previous run (a crash, a hard kill on
// Windows) is dead. Recover them all before listening so the sweep cannot race a new request. A
// database hiccup here must not keep the API down, so a failure is logged and boot continues.
if (config.shouldRecoverStaleOnBoot) {
  try {
    const { turns, locks } = await recoverAtBoot()
    if (turns > 0 || locks > 0) {
      logger.warn({ turns, locks }, 'recovered turns and locks left by a previous run')
    }
  } catch (err: unknown) {
    logger.error({ err }, 'boot recovery failed')
  }
}

const server = app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port }, 'backend listening')
})

let isShuttingDown = false

function shutdown(signal: string): void {
  if (isShuttingDown) return
  isShuttingDown = true
  logger.info({ signal }, 'shutting down')
  const force = setTimeout(() => {
    logger.error('shutdown timed out, forcing exit')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  force.unref()
  // Abort running generations first: each one persists `aborted` and releases its lock through
  // `MessageService.finish`, which ends its SSE response, so server.close() below can complete.
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
