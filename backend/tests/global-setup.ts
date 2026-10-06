import { ensureDatabase } from '../src/lib/db/ensure-database.js'
import { createDb } from '../src/lib/db/index.js'
import { reset } from '../src/lib/db/migrate.js'

export const SERVER_URL = 'postgres://ai_tutor:ai_tutor@localhost:5432/postgres'
export const TEST_DATABASE_URL = 'postgres://ai_tutor:ai_tutor@localhost:5432/ai_tutor_test'
export const SCHEMA_CHECK_DATABASE_URL =
  'postgres://ai_tutor:ai_tutor@localhost:5432/ai_tutor_schema_check'

export default async function setup(): Promise<void> {
  await ensureDatabase(SERVER_URL, 'ai_tutor_test')
  await ensureDatabase(SERVER_URL, 'ai_tutor_schema_check')
  const { db, pool } = createDb(TEST_DATABASE_URL)
  try {
    await reset(pool)
  } finally {
    await db.destroy()
  }
}
