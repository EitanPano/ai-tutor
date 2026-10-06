import { SESSION_TTL_MS } from '../lib/cookie.js'
import type { Db } from '../lib/db/index.js'
import { unauthorized } from '../lib/error.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { createSessionToken, hashSessionToken } from '../lib/session-token.js'
import { toUserDto, type UserDto } from './user.service.js'

export type ResolvedSession = { sessionId: string; userId: string; expiresAt: Date }

// Verified when the email is unknown so response time does not reveal which emails exist.
let dummyHash: Promise<string> | undefined
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('not-a-real-password')
  return dummyHash
}

function invalidCredentials() {
  return unauthorized('Wrong email or password.', 'invalid_credentials')
}

/** Inserts a session for `userId` and returns the raw token (only its hash is stored). */
export async function startSession(db: Db, userId: string): Promise<string> {
  const token = createSessionToken()
  await db
    .insertInto('session')
    .values({
      user_id: userId,
      token_hash: hashSessionToken(token),
      expires_at: new Date(Date.now() + SESSION_TTL_MS)
    })
    .execute()
  return token
}

/** Verifies credentials, rotates the session, and returns the user with a fresh token. */
export async function login(
  db: Db,
  input: { email: string; password: string },
  currentToken?: string
): Promise<{ user: UserDto; token: string }> {
  const row = await db
    .selectFrom('app_user')
    .selectAll()
    .where('email', '=', input.email.trim())
    .where('deleted_at', 'is', null)
    .executeTakeFirst()

  const hash = row?.password_hash ?? (await getDummyHash())
  const passwordOk = await verifyPassword(hash, input.password)
  if (!row || !passwordOk) throw invalidCredentials()

  const token = await db.transaction().execute(async (trx) => {
    if (currentToken) {
      await trx
        .deleteFrom('session')
        .where('token_hash', '=', hashSessionToken(currentToken))
        .execute()
    }
    return startSession(trx, row.id)
  })
  return { user: toUserDto(row), token }
}

/** The session for a valid, unexpired token of a non-deleted user, else undefined. */
export async function resolveSession(db: Db, token: string): Promise<ResolvedSession | undefined> {
  const row = await db
    .selectFrom('session')
    .innerJoin('app_user', 'app_user.id', 'session.user_id')
    .select(['session.id as sessionId', 'session.user_id as userId', 'session.expires_at'])
    .where('session.token_hash', '=', hashSessionToken(token))
    .where('session.expires_at', '>', new Date())
    .where('app_user.deleted_at', 'is', null)
    .executeTakeFirst()
  return row && { sessionId: row.sessionId, userId: row.userId, expiresAt: row.expires_at }
}

/** Pushes the session expiry to now + 30 days and returns the new expiry. */
export async function extendSession(db: Db, sessionId: string): Promise<Date> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db
    .updateTable('session')
    .set({ expires_at: expiresAt })
    .where('id', '=', sessionId)
    .execute()
  return expiresAt
}

export async function logout(db: Db, token: string): Promise<void> {
  await db.deleteFrom('session').where('token_hash', '=', hashSessionToken(token)).execute()
}
