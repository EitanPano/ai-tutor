import { loadConfig } from '../config.js'
import { createDb } from './index.js'
import { migrate, reset, rollback } from './migrate.js'
import { seed } from './seed.js'

const log = (message: string) => console.log(message)

async function main(): Promise<void> {
  const command = process.argv[2]
  const config = loadConfig()
  const { db, pool } = createDb(config.databaseUrl)
  try {
    switch (command) {
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
      default:
        throw new Error(`Unknown command "${command}". Use migrate | rollback | reset | seed`)
    }
  } finally {
    await db.destroy()
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
