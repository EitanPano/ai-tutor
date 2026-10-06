import type { Db } from './index.js'

type Log = (message: string) => void

/** Idempotent. Task 5 adds the demo user. */
export function seed(_db: Db, log: Log = () => {}): Promise<void> {
  log('nothing to seed yet')
  return Promise.resolve()
}
