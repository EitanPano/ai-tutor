import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type pg from 'pg'

export const MIGRATION_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../db/migration'
)

const UP_MARKER = '-- migrate:up'
const DOWN_MARKER = '-- migrate:down'

type Migration = { name: string; up: string; down: string }
type Log = (message: string) => void

/** Markers must be whole lines; a marker mentioned inside a comment or string does not count. */
export function parseMigration(name: string, sql: string): Migration {
  const lines = sql.split(/\r?\n/)
  const markerLines = (marker: string) =>
    lines.flatMap((line, index) => (line.trim() === marker ? [index] : []))
  const ups = markerLines(UP_MARKER)
  const downs = markerLines(DOWN_MARKER)
  const upAt = ups[0]
  const downAt = downs[0]
  if (
    ups.length !== 1 ||
    downs.length !== 1 ||
    upAt === undefined ||
    downAt === undefined ||
    downAt < upAt
  ) {
    throw new Error(
      `Migration ${name} needs exactly one "${UP_MARKER}" line followed by one "${DOWN_MARKER}" line`
    )
  }
  const preamble = lines.slice(0, upAt).filter((line) => line.trim() !== '')
  if (preamble.some((line) => !line.trim().startsWith('--'))) {
    throw new Error(`Migration ${name} has non-comment text before "${UP_MARKER}"`)
  }
  return {
    name,
    up: lines
      .slice(upAt + 1, downAt)
      .join('\n')
      .trim(),
    down: lines
      .slice(downAt + 1)
      .join('\n')
      .trim()
  }
}

async function loadMigrations(dir: string): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort()
  return Promise.all(
    files.map(async (file) => parseMigration(file, await readFile(path.join(dir, file), 'utf8')))
  )
}

async function ensureTrackingTable(pool: pg.Pool): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migration (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
}

async function appliedNames(pool: pg.Pool): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    'SELECT name FROM schema_migration ORDER BY name'
  )
  return rows.map((row) => row.name)
}

async function inTransaction(
  pool: pg.Pool,
  run: (client: pg.PoolClient) => Promise<void>
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await run(client)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Applies every pending migration, each file in its own transaction. Returns applied names. */
export async function migrate(
  pool: pg.Pool,
  log: Log = () => {},
  dir: string = MIGRATION_DIR
): Promise<string[]> {
  const migrations = await loadMigrations(dir)
  await ensureTrackingTable(pool)
  const done = new Set(await appliedNames(pool))
  const applied: string[] = []
  for (const migration of migrations) {
    if (done.has(migration.name)) continue
    await inTransaction(pool, async (client) => {
      await client.query(migration.up)
      await client.query('INSERT INTO schema_migration (name) VALUES ($1)', [migration.name])
    })
    log(`applied ${migration.name}`)
    applied.push(migration.name)
  }
  return applied
}

/** Reverts the last `steps` applied migrations, newest first. Returns rolled-back names. */
export async function rollback(
  pool: pg.Pool,
  steps = 1,
  log: Log = () => {},
  dir: string = MIGRATION_DIR
): Promise<string[]> {
  const migrations = new Map((await loadMigrations(dir)).map((m) => [m.name, m]))
  await ensureTrackingTable(pool)
  const targets = (await appliedNames(pool)).reverse().slice(0, steps)
  for (const name of targets) {
    const migration = migrations.get(name)
    if (!migration) throw new Error(`Applied migration ${name} has no file in ${dir}`)
    await inTransaction(pool, async (client) => {
      await client.query(migration.down)
      await client.query('DELETE FROM schema_migration WHERE name = $1', [name])
    })
    log(`rolled back ${name}`)
  }
  return targets
}

/** Drops and recreates the public schema, then migrates. Never runs in production. */
export async function reset(
  pool: pg.Pool,
  log: Log = () => {},
  dir: string = MIGRATION_DIR
): Promise<string[]> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to reset the database when NODE_ENV=production')
  }
  await pool.query('DROP SCHEMA public CASCADE')
  await pool.query('CREATE SCHEMA public')
  return migrate(pool, log, dir)
}
