import type { Db } from '../lib/db/index.js'
import type { AppUserRow } from '../lib/db/schema.js'
import { badRequest, conflict } from '../lib/error.js'
import { hashPassword } from '../lib/password.js'
import { requireFound, type Auth } from './ownership.js'
import { startSession } from './session.service.js'

export type UserDto = {
  id: string
  email: string
  displayName: string
  timeZone: string
  createdAt: string
}

export type CreateUserInput = {
  email: string
  password: string
  displayName: string
  timeZone: string
}

/** Explicit mapping: the password hash must never leave the service layer. */
export function toUserDto(row: AppUserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    timeZone: row.time_zone,
    createdAt: row.created_at.toISOString()
  }
}

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
  } catch (err) {
    if (!(err instanceof RangeError)) throw err
    throw badRequest('validation_failed', 'The request is invalid.', {
      issues: [{ path: ['timeZone'], message: 'Must be an IANA time zone such as Europe/Paris.' }]
    })
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23505'
}

/** Creates the user and their first session in one transaction. */
export async function createUser(
  db: Db,
  input: CreateUserInput
): Promise<{ user: UserDto; token: string }> {
  assertTimeZone(input.timeZone)
  const passwordHash = await hashPassword(input.password)
  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('app_user')
        .values({
          email: input.email.trim(),
          password_hash: passwordHash,
          display_name: input.displayName,
          time_zone: input.timeZone
        })
        .returningAll()
        .executeTakeFirstOrThrow()
      const token = await startSession(trx, row.id)
      return { user: toUserDto(row), token }
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict('email_taken', 'An account with this email already exists.')
    }
    throw err
  }
}

export async function getUser(db: Db, auth: Auth): Promise<UserDto> {
  const row = await db
    .selectFrom('app_user')
    .selectAll()
    .where('id', '=', auth.userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst()
  return toUserDto(requireFound(row))
}

export async function updateUser(
  db: Db,
  auth: Auth,
  input: { displayName?: string; timeZone?: string }
): Promise<UserDto> {
  if (input.timeZone !== undefined) assertTimeZone(input.timeZone)
  const changes = {
    ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
    ...(input.timeZone !== undefined ? { time_zone: input.timeZone } : {})
  }
  if (Object.keys(changes).length === 0) return getUser(db, auth)
  const row = await db
    .updateTable('app_user')
    .set(changes)
    .where('id', '=', auth.userId)
    .where('deleted_at', 'is', null)
    .returningAll()
    .executeTakeFirst()
  return toUserDto(requireFound(row))
}
