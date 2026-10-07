import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from '../../src/lib/db/index.js'
import {
  MIGRATION_DIR,
  migrate,
  parseMigration,
  reset,
  rollback
} from '../../src/lib/db/migrate.js'
import { SCHEMA_CHECK_DATABASE_URL, TEST_DATABASE_URL } from '../global-setup.js'

const SCHEMA_SQL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/schema.sql')

const test = createDb(TEST_DATABASE_URL)
const check = createDb(SCHEMA_CHECK_DATABASE_URL)

afterAll(async () => {
  // Leave the fully migrated schema behind: later files must not see an empty database.
  await reset(test.pool)
  await test.db.destroy()
  await check.db.destroy()
})

async function snapshot(pool: pg.Pool) {
  const columns = await pool.query(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name <> 'schema_migration'
    ORDER BY table_name, column_name`)
  const indexes = await pool.query(`
    SELECT tablename, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename <> 'schema_migration'
    ORDER BY tablename, indexdef`)
  const constraints = await pool.query(`
    SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text <> 'schema_migration'
    ORDER BY table_name, conname`)
  const extensions = await pool.query('SELECT extname FROM pg_extension ORDER BY extname')
  return {
    columns: columns.rows,
    indexes: indexes.rows,
    constraints: constraints.rows,
    extensions: extensions.rows
  }
}

/** Tables (other than the tracking table) and extensions (other than plpgsql) that exist. */
async function migratedObjects(pool: pg.Pool) {
  const tables = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> 'schema_migration' ORDER BY tablename`
  )
  const extensions = await pool.query<{ extname: string }>(
    `SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname`
  )
  return {
    tables: tables.rows.map((row) => row.tablename),
    extensions: extensions.rows.map((row) => row.extname)
  }
}

describe('migrations', () => {
  it('applies up, rolls back everything, and applies up again', async () => {
    await reset(test.pool)
    await rollback(test.pool, 1000)
    const { rows: afterRollback } = await test.pool.query('SELECT name FROM schema_migration')
    expect(afterRollback).toEqual([])
    expect(await migratedObjects(test.pool)).toEqual({ tables: [], extensions: [] })
    const applied = await migrate(test.pool)
    expect(applied.length).toBeGreaterThan(0)
    expect((await migratedObjects(test.pool)).extensions).toEqual(['citext'])
    expect(await migrate(test.pool)).toEqual([])
  })

  it('rejects a migration file without a down section', () => {
    expect(() => parseMigration('x.sql', '-- migrate:up\nSELECT 1;')).toThrow(/migrate:down/)
  })

  it('only treats whole-line markers as markers', () => {
    const parsed = parseMigration(
      'x.sql',
      '-- header comment\n-- migrate:up\nSELECT 1; -- migrate:down is mentioned here\n\n-- migrate:down\nSELECT 2;\n'
    )
    expect(parsed.up).toBe('SELECT 1; -- migrate:down is mentioned here')
    expect(parsed.down).toBe('SELECT 2;')
  })

  it('rejects non-comment text before the up marker', () => {
    expect(() =>
      parseMigration('x.sql', 'SELECT 0;\n-- migrate:up\nSELECT 1;\n-- migrate:down\nSELECT 2;')
    ).toThrow(/before "-- migrate:up"/)
  })

  it('rejects duplicate markers', () => {
    expect(() =>
      parseMigration('x.sql', '-- migrate:up\nSELECT 1;\n-- migrate:up\n-- migrate:down\nSELECT 2;')
    ).toThrow(/exactly one/)
  })
})

describe('schema.sql', () => {
  it('matches the schema produced by the migrations', async () => {
    await reset(test.pool)
    await check.pool.query('DROP SCHEMA public CASCADE')
    await check.pool.query('CREATE SCHEMA public')
    await check.pool.query(await readFile(SCHEMA_SQL, 'utf8'))
    expect(await snapshot(check.pool)).toEqual(await snapshot(test.pool))
  })
})

describe('007-normalise-time-zone', () => {
  it('remaps legacy and offset zones, keeps valid ones, and is idempotent', async () => {
    await reset(test.pool)
    const file = await readFile(path.join(MIGRATION_DIR, '007-normalise-time-zone.sql'), 'utf8')
    const { up } = parseMigration('007-normalise-time-zone.sql', file)
    const zones: Record<string, string> = {
      'Asia/Calcutta': 'Asia/Kolkata',
      'europe/kiev': 'Europe/Kyiv',
      'europe/paris': 'Europe/Paris',
      '+01:00': 'UTC',
      'Mars/Olympus': 'UTC',
      'America/New_York': 'America/New_York'
    }
    let n = 0
    for (const zone of Object.keys(zones)) {
      n += 1
      await test.pool.query(
        `INSERT INTO app_user (email, password_hash, display_name, time_zone)
         VALUES ($1, 'x', 'u', $2)`,
        [`tz${n}@example.com`, zone]
      )
    }
    await test.pool.query(up)
    await test.pool.query(up)
    const { rows } = await test.pool.query<{ email: string; time_zone: string }>(
      'SELECT email, time_zone FROM app_user ORDER BY email'
    )
    expect(rows.map((row) => row.time_zone)).toEqual(Object.values(zones))
    await test.pool.query('TRUNCATE app_user CASCADE')
  })
})
