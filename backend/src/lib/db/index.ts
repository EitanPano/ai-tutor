import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from './schema.js'

export type Db = Kysely<Database>

export function createDb(databaseUrl: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 })
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
  return { db, pool }
}
