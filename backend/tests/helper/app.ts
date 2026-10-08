import type { Express } from 'express'
import { sql } from 'kysely'
import { stopServer } from './client.js'
import { createApp, type RecoverAtBoot } from '../../src/app.js'
import type { Services } from '../../src/context.js'
import { loadConfig, type Config } from '../../src/lib/config.js'
import { createDb, type Db } from '../../src/lib/db/index.js'
import { InFlightRegistry } from '../../src/lib/in-flight.js'
import { createLogger } from '../../src/lib/logger.js'
import { FakeTutorProvider } from '../../src/lib/tutor/fake.provider.js'

export type TestApp = {
  app: Express
  /** The services the app was built with (`ctx.services`). */
  services: Services
  /** The boot recovery, as `createApp` returns it. */
  recoverAtBoot: RecoverAtBoot
  config: Config
  db: Db
  /** The fake tutor wired into the app; `tutor.calls` records every explain input. */
  tutor: FakeTutorProvider
  /** The registry of running generations. `abortAll()` closes it for good: use a private app. */
  inFlight: InFlightRegistry
  close: () => Promise<void>
}

/** Builds the app against the real test database. Pass `databaseUrl` to point elsewhere. */
export function createTestApp(
  overrides: {
    databaseUrl?: string
    extraRoutes?: (app: Express) => void
    config?: Partial<Config>
  } = {}
): TestApp {
  const config = { ...loadConfig(process.env), ...overrides.config }
  const tutor = new FakeTutorProvider({ delayMs: 0, record: true })
  const databaseUrl = overrides.databaseUrl ?? config.databaseUrl
  const { db, pool } = createDb(databaseUrl)
  const inFlight = new InFlightRegistry()
  const { app, ctx, recoverAtBoot } = createApp({
    config,
    db,
    pool,
    logger: createLogger(config),
    tutor,
    inFlight,
    ...(overrides.extraRoutes ? { extraRoutes: overrides.extraRoutes } : {})
  })
  return {
    app,
    services: ctx.services,
    recoverAtBoot,
    config,
    db,
    tutor,
    inFlight,
    close: async () => {
      await stopServer(app)
      await db.destroy()
    }
  }
}

/** Empties every table except `schema_migration` and `topic` (reference data seeded by migration). */
export async function truncateAll(db: Db): Promise<void> {
  const { rows } = await sql<{ tablename: string }>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('schema_migration', 'topic')`.execute(db)
  if (rows.length === 0) return
  const names = rows.map((row) => `"${row.tablename}"`).join(', ')
  await sql.raw(`TRUNCATE ${names} RESTART IDENTITY CASCADE`).execute(db)
}
