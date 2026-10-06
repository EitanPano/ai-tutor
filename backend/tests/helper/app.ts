import type { Express } from 'express'
import { sql } from 'kysely'
import { createApp } from '../../src/app.js'
import { loadConfig, type Config } from '../../src/lib/config.js'
import { createDb, type Db } from '../../src/lib/db/index.js'
import { createLogger } from '../../src/lib/logger.js'

export type TestApp = { app: Express; config: Config; db: Db; close: () => Promise<void> }

/** Builds the app against the real test database. Pass `databaseUrl` to point elsewhere. */
export function createTestApp(overrides: { databaseUrl?: string } = {}): TestApp {
  const config = loadConfig(process.env)
  const databaseUrl = overrides.databaseUrl ?? config.databaseUrl
  const { db } = createDb(databaseUrl)
  const app = createApp({ config, db, logger: createLogger(config) })
  return { app, config, db, close: () => db.destroy() }
}

/** Empties every table except `schema_migration`. */
export async function truncateAll(db: Db): Promise<void> {
  const { rows } = await sql<{ tablename: string }>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> 'schema_migration'`.execute(db)
  if (rows.length === 0) return
  const names = rows.map((row) => `"${row.tablename}"`).join(', ')
  await sql.raw(`TRUNCATE ${names} RESTART IDENTITY CASCADE`).execute(db)
}
