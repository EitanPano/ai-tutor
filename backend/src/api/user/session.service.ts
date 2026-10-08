import { SESSION_MAX_AGE_MS, SESSION_TTL_MS } from '../../lib/cookie.js'
import type { Db } from '../../lib/db/index.js'
import { unauthorized } from '../../lib/error.js'
import { hashPassword, verifyPassword } from '../../lib/password.js'
import { createSessionToken, hashSessionToken } from '../../lib/session-token.js'
import { DAY_MS } from '../../lib/time.js'
import { toUserDto, type UserDto } from './dto.js'

type ResolvedSession = {
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
  return unauthorized('invalid_credentials', 'Wrong email or password.')
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

/** The furthest a session created at `createdAt` may be extended to: now + 30 days, capped. */
function slidingExpiry(createdAt: Date): Date {
  return new Date(Math.min(Date.now() + SESSION_TTL_MS, createdAt.getTime() + SESSION_MAX_AGE_MS))
}

/** The session for a valid, unexpired token of a non-deleted user, else undefined. */
async function resolveSession(db: Db, token: string): Promise<ResolvedSession | undefined> {
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

export type SessionServiceDeps = { db: Db }

export type SessionService = {
  /** Verifies credentials, rotates the session, and returns the user with a fresh token. */
  login(
    input: { email: string; password: string },
    currentToken?: string
  ): Promise<{ user: UserDto; token: string }>
  /**
   * The user of a valid, unexpired token of a non-deleted user, else undefined. Slides the expiry
   * (never past the absolute cap) when the session could gain a day; `isExtended` reports that the
   * expiry moved, so the caller re-sends the cookie.
   */
  authenticate(token: string): Promise<{ userId: string; isExtended: boolean } | undefined>
  logout(token: string): Promise<void>
}

export function createSessionService({ db }: SessionServiceDeps): SessionService {
  return {
    async login(input, currentToken) {
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
    },

    async authenticate(token) {
      const session = await resolveSession(db, token)
      if (!session) return undefined
      const expiresAt = slidingExpiry(session.createdAt)
      // Extend only once the session could gain a day, so it is written at most daily. Near the
      // absolute cap the target stops moving, so it stops being written too.
      const isExtended = expiresAt.getTime() - session.expiresAt.getTime() > DAY_MS
      if (isExtended) {
        await db
          .updateTable('session')
          .set({ expires_at: expiresAt })
          .where('id', '=', session.sessionId)
          .execute()
      }
      return { userId: session.userId, isExtended }
    },

    async logout(token) {
      await db.deleteFrom('session').where('token_hash', '=', hashSessionToken(token)).execute()
    }
  }
}
