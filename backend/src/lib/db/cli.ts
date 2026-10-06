import { loadConfig } from '../config.js'
import { ensureDatabase } from './ensure-database.js'
import { createDb } from './index.js'
import { migrate, reset, rollback } from './migrate.js'
import { resetPassword } from './reset-password.js'
import { seed } from './seed.js'

const log = (message: string) => console.log(message)

async function main(): Promise<void> {
  const command = process.argv[2]
  const config = loadConfig()
  const { db, pool } = createDb(config.databaseUrl)
  try {
    switch (command) {
      case 'ensure-db':
        await ensureDatabase(config.databaseUrl, new URL(config.databaseUrl).pathname.slice(1))
        break
      case 'migrate':
        await migrate(pool, log)
        break
      case 'rollback':
        await rollback(pool, 1, log)
        break
      case 'reset':
        await reset(pool, log)
        break
      case 'seed':
        await seed(db, log)
        break
      case 'reset-password': {
        const email = process.argv[3]
        if (!email) throw new Error('Usage: reset-password <email>')
        const password = await resetPassword(db, email)
        if (!password) throw new Error('No active user with that email')
        log('All sessions for that user were ended. Temporary password (shown once):')
        log(password)
        break
      }
      default:
        throw new Error(
          `Unknown command "${command}". Use ensure-db | migrate | rollback | reset | seed | reset-password <email>`
        )
    }
  } finally {
    await db.destroy()
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
