import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { loadConfig } from '../../src/lib/config.js'
import { createDb } from '../../src/lib/db/index.js'
import { InFlightRegistry } from '../../src/lib/in-flight.js'
import { createLogger } from '../../src/lib/logger.js'
import { FakeTutorProvider } from '../../src/lib/tutor/fake.provider.js'
import { truncateAll } from '../helper/app.js'
import { createClient, signUp } from '../helper/client.js'

const config = loadConfig(process.env)
const { db, pool } = createDb(config.databaseUrl)

// The turn sweep starts with a `selectFrom('message')` probe; `failSweep` makes any read fail, which
// the boot recovery's lock release (an update) does not use.
const sweep = { fail: false }
const flaky = new Proxy(db, {
  get(target, prop) {
    const value: unknown = Reflect.get(target, prop, target)
    if (prop === 'selectFrom' && sweep.fail) {
      return () => {
        throw new Error('sweep failed')
      }
    }
    return typeof value === 'function' ? (value as () => unknown).bind(target) : value
  }
})

const { app, modules } = createApp({
  config,
  db: flaky,
  pool,
  logger: createLogger(config),
  tutor: new FakeTutorProvider({ delayMs: 0, record: true }),
  inFlight: new InFlightRegistry()
})
const client = createClient(app, config)

beforeEach(async () => {
  sweep.fail = false
  await truncateAll(db)
})
afterAll(() => db.destroy())

describe('recoverAtBoot', () => {
  it('still releases every lock when the turn sweep fails, and rethrows the failure', async () => {
    const { user } = await signUp(client)
    await modules.ai.acquireLock({ userId: user.id })
    sweep.fail = true
    await expect(modules.recoverAtBoot()).rejects.toThrow('sweep failed')
    const row = await db
      .selectFrom('app_user')
      .select('generation_started_at')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow()
    expect(row.generation_started_at).toBeNull()
  })
})
