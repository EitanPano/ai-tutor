import pg from 'pg'

const NAME_PATTERN = /^[a-z_][a-z0-9_]*$/

/** Creates database `name` on the server behind `adminUrl` when it does not exist yet. */
export async function ensureDatabase(adminUrl: string, name: string): Promise<void> {
  if (!NAME_PATTERN.test(name)) throw new Error(`Invalid database name: ${name}`)
  const url = new URL(adminUrl)
  url.pathname = '/postgres'
  const client = new pg.Client({ connectionString: url.toString() })
  await client.connect()
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
    if (rowCount === 0) await client.query(`CREATE DATABASE ${name}`)
  } finally {
    await client.end()
  }
}
