import { sql } from 'kysely'
import type { Db } from '../../lib/db/index.js'

export type HealthServiceDeps = { db: Db }

export type HealthService = {
  /** Resolves once the database answers `SELECT 1`; rejects with the driver's error otherwise. */
  ping(): Promise<void>
}

export function createHealthService({ db }: HealthServiceDeps): HealthService {
  return {
    async ping() {
      await sql`SELECT 1`.execute(db)
    }
  }
}
