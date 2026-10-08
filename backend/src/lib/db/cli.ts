import { loadDbConfig } from '../config.js'
import { ensureDatabase } from './ensure-database.js'
import { createDb } from './index.js'
import { migrate, reset, rollback } from './migrate.js'
import { resetPassword } from './reset-password.js'
import { seed } from './seed.js'

const log = (message: string) => console.log(message)

/** What a command runs against: the open database, its URL, and the arguments after its name. */
type CommandContext = ReturnType<typeof createDb> & { databaseUrl: string; args: string[] }

const COMMAND_BY_NAME = new Map<string, (context: CommandContext) => Promise<unknown>>([
  [
    'ensure-db',
    ({ databaseUrl }) => ensureDatabase(databaseUrl, new URL(databaseUrl).pathname.slice(1))
  ],
  ['migrate', ({ pool }) => migrate(pool, log)],
  ['rollback', ({ pool }) => rollback(pool, 1, log)],
  ['reset', ({ pool }) => reset(pool, log)],
  ['seed', ({ db }) => seed(db, log)],
  [
    'reset-password',
    async ({ db, args: [email] }) => {
      if (!email) throw new Error('Usage: reset-password <email>')
      const password = await resetPassword(db, email)
      if (!password) throw new Error('No active user with that email')
      log('All sessions for that user were ended. Temporary password (shown once):')
      log(password)
    }
  ]
])

async function main(): Promise<void> {
  const name = process.argv[2]
  const config = loadDbConfig()
  const { db, pool } = createDb(config.databaseUrl, undefined, { statementTimeoutMs: null })
  try {
    const command = name === undefined ? undefined : COMMAND_BY_NAME.get(name)
    if (!command) {
      throw new Error(
        `Unknown command "${name}". Use ensure-db | migrate | rollback | reset | seed | reset-password <email>`
      )
    }
    await command({ db, pool, databaseUrl: config.databaseUrl, args: process.argv.slice(3) })
  } finally {
    await db.destroy()
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
