import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Logger } from '../logger.js'
import type { Database } from './schema.js'
import { markPoolConnectError } from './unavailable.js'

export type Db = Kysely<Database>

// A paused or unreachable Postgres must fail a request, not hang it.
const CONNECTION_TIMEOUT_MS = 5_000
// A slow query gives up instead of holding one of the 10 pooled connections.
const STATEMENT_TIMEOUT_MS = 15_000
// A transaction left open by a stuck request is ended by the server and frees its locks.
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000

type CreateDbOptions = {
  /** `null` disables the statement timeout (operator CLI: a migration may run long). */
  statementTimeoutMs?: number | null
}

/**
 * `logger` receives idle-client errors (e.g. after a Postgres restart). Without a listener
 * pg's pool re-emits them as uncaught exceptions and the process dies.
 */
export function createDb(
  databaseUrl: string,
  logger?: Pick<Logger, 'error'>,
  options: CreateDbOptions = {}
): { db: Db; pool: pg.Pool } {
  const statementTimeoutMs =
    options.statementTimeoutMs === undefined ? STATEMENT_TIMEOUT_MS : options.statementTimeoutMs
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
    ...(statementTimeoutMs === null ? {} : { statement_timeout: statementTimeoutMs })
  })
  // Kysely gets its clients through the promise form of connect(). Tag its failures so the
  // error middleware can tell "no database connection" from any other network error.
  const connect = pool.connect.bind(pool) as () => Promise<pg.PoolClient>
  const connectTagged = async (): Promise<pg.PoolClient> => {
    try {
      return await connect()
    } catch (err) {
      markPoolConnectError(err)
      throw err
    }
  }
  pool.connect = ((...args: unknown[]) =>
    args.length === 0
      ? connectTagged()
      : (connect as (...a: unknown[]) => unknown)(...args)) as typeof pool.connect
  pool.on('error', (err) => {
    if (logger) logger.error({ err }, 'idle database client error')
    else console.error(`idle database client error: ${err.message}`)
  })
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
  return { db, pool }
}
