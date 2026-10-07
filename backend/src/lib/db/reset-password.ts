import { randomBytes } from 'node:crypto'
import { hashPassword } from '../password.js'
import type { Db } from './index.js'

const PASSWORD_LENGTH = 16

/**
 * Operator tool: sets a new random password for `email` and signs the user out everywhere.
 * Returns the temporary password (print it once, never log it), or undefined for an unknown email.
 */
export async function resetPassword(db: Db, email: string): Promise<string | undefined> {
  const password = randomBytes(PASSWORD_LENGTH).toString('base64url').slice(0, PASSWORD_LENGTH)
  const passwordHash = await hashPassword(password)
  return db.transaction().execute(async (trx) => {
    const user = await trx
      .updateTable('app_user')
      .set({ password_hash: passwordHash })
      .where('email', '=', email.trim())
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst()
    if (!user) return undefined
    await trx.deleteFrom('session').where('user_id', '=', user.id).execute()
    return password
  })
}
