import { SESSION_MAX_AGE_MS, SESSION_TTL_MS } from '../lib/cookie.js'
import type { Db } from '../lib/db/index.js'
import { unauthorized } from '../lib/error.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { createSessionToken, hashSessionToken } from '../lib/session-token.js'
import { toUserDto, type UserDto } from './user.dto.js'

export type ResolvedSession = {
  sessionId: string
  userId: string
  expiresAt: Date
  createdAt: Date
}

// Verified when the email is unknown so response time does not reveal which emails exist.
let dummyHash: Promise<string> | undefined
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('not-a-real-password')
  return dummyHash
}

/** Computes the dummy hash at startup so the first unknown-email login is not ~2x slower. */
export function warmDummyHash(): void {
  getDummyHash().catch(() => {
    dummyHash = undefined
  })
}

function invalidCredentials() {
  return unauthorized('Wrong email or password.', 'invalid_credentials')
}

/** Inserts a session for `userId` and returns the raw token (only its hash is stored). */
export async function startSession(db: Db, userId: string): Promise<string> {
  const token = createSessionToken()
  // Expired rows are never read again: purge this user's so the table does not grow unbounded.
  await db
    .deleteFrom('session')
    .where('user_id', '=', userId)
    .where('expires_at', '<', new Date())
    .execute()
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
    .select([
      'session.id as sessionId',
      'session.user_id as userId',
      'session.expires_at',
      'session.created_at'
    ])
    .where('session.token_hash', '=', hashSessionToken(token))
    .where('session.expires_at', '>', new Date())
    .where('session.created_at', '>', new Date(Date.now() - SESSION_MAX_AGE_MS))
    .where('app_user.deleted_at', 'is', null)
    .executeTakeFirst()
  return (
    row && {
      sessionId: row.sessionId,
      userId: row.userId,
      expiresAt: row.expires_at,
      createdAt: row.created_at
    }
  )
}

/** The furthest a session created at `createdAt` may be extended to: now + 30 days, capped. */
export function slidingExpiry(createdAt: Date): Date {
  return new Date(Math.min(Date.now() + SESSION_TTL_MS, createdAt.getTime() + SESSION_MAX_AGE_MS))
}

/** Pushes the session expiry to `slidingExpiry` (never past the absolute cap) and returns it. */
export async function extendSession(db: Db, sessionId: string, createdAt: Date): Promise<Date> {
  const expiresAt = slidingExpiry(createdAt)
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
