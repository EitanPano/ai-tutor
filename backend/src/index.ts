import { createApp } from './app.js'
import { loadConfig } from './lib/config.js'
import { createDb } from './lib/db/index.js'
import { createLogger } from './lib/logger.js'

const config = loadConfig()
const logger = createLogger(config)
const { db } = createDb(config.databaseUrl)
const app = createApp({ config, db, logger })

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, 'backend listening')
})

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down')
  server.close(() => {
    // Kysely's destroy() ends the underlying pg pool.
    db.destroy()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        logger.error({ err }, 'error closing the database pool')
        process.exit(1)
      })
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
