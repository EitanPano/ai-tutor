import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Logger } from '../logger.js'
import type { Database } from './schema.js'

export type Db = Kysely<Database>

/**
 * `logger` receives idle-client errors (e.g. after a Postgres restart). Without a listener
 * pg's pool re-emits them as uncaught exceptions and the process dies.
 */
export function createDb(
  databaseUrl: string,
  logger?: Pick<Logger, 'error'>
): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 })
  pool.on('error', (err) => {
    if (logger) logger.error({ err }, 'idle database client error')
    else console.error(`idle database client error: ${err.message}`)
  })
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
  return { db, pool }
}
