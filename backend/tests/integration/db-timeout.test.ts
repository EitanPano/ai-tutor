import { afterAll, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import { TEST_DATABASE_URL } from '../global-setup.js'
import { createDb } from '../../src/lib/db/index.js'

const defaults = createDb(TEST_DATABASE_URL)
const cli = createDb(TEST_DATABASE_URL, undefined, { statementTimeoutMs: null })

afterAll(async () => {
  await defaults.db.destroy()
  await cli.db.destroy()
})

const show = async (db: typeof defaults.db) =>
  (await sql<{ statement_timeout: string }>`SHOW statement_timeout`.execute(db)).rows[0]
    ?.statement_timeout

describe('createDb timeouts', () => {
  it('applies a 15 s statement timeout by default', async () => {
    expect(await show(defaults.db)).toBe('15s')
  })

  it('applies a 30 s idle-in-transaction timeout', async () => {
    const rows = (
      await sql<{
        idle_in_transaction_session_timeout: string
      }>`SHOW idle_in_transaction_session_timeout`.execute(defaults.db)
    ).rows
    expect(rows[0]?.idle_in_transaction_session_timeout).toBe('30s')
  })

  it('leaves the statement timeout off when the CLI option asks for it', async () => {
    expect(await show(cli.db)).toBe('0')
  })
})
