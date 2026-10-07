import { ensureDatabase } from '../src/lib/db/ensure-database.js'
import { createDb } from '../src/lib/db/index.js'
import { reset } from '../src/lib/db/migrate.js'
import { SCHEMA_CHECK_DATABASE_NAME, TEST_DATABASE_NAME } from './helper/test-database-name.js'

export const SERVER_URL = 'postgres://ai_tutor:ai_tutor@127.0.0.1:5432/postgres'
export const TEST_DATABASE_URL = `postgres://ai_tutor:ai_tutor@127.0.0.1:5432/${TEST_DATABASE_NAME}`
export const SCHEMA_CHECK_DATABASE_URL = `postgres://ai_tutor:ai_tutor@127.0.0.1:5432/${SCHEMA_CHECK_DATABASE_NAME}`

export default async function setup(): Promise<void> {
  await ensureDatabase(SERVER_URL, TEST_DATABASE_NAME)
  await ensureDatabase(SERVER_URL, SCHEMA_CHECK_DATABASE_NAME)
  const { db, pool } = createDb(TEST_DATABASE_URL)
  try {
    await reset(pool)
  } finally {
    await db.destroy()
  }
}
