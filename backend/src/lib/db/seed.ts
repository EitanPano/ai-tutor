import { hashPassword } from '../password.js'
import type { Db } from './index.js'

type Log = (message: string) => void

export const DEMO_EMAIL = 'demo@example.com'
export const DEMO_PASSWORD = 'demo-password'

/** Idempotent. Refuses to run in production: the demo account has a published password. */
export async function seed(db: Db, log: Log = () => {}): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed the database when NODE_ENV=production')
  }
  const inserted = await db
    .insertInto('app_user')
    .values({
      email: DEMO_EMAIL,
      password_hash: await hashPassword(DEMO_PASSWORD),
      display_name: 'Demo Developer',
      time_zone: 'UTC'
    })
    .onConflict((conflict) => conflict.column('email').doNothing())
    .returning('id')
    .executeTakeFirst()
  log(inserted ? `created demo user ${DEMO_EMAIL}` : `demo user ${DEMO_EMAIL} already exists`)
}
