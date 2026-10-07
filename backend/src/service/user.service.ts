import type { Db } from '../lib/db/index.js'
import { badRequest, conflict } from '../lib/error.js'
import { hashPassword } from '../lib/password.js'
import { normaliseTimeZone } from '../lib/time-zone.js'
import { requireFound, type Auth } from './ownership.js'
import { startSession } from './session.service.js'
import { toUserDto, type UserDto } from './user.dto.js'

export type CreateUserInput = {
  email: string
  password: string
  displayName: string
  timeZone: string
}

/** The spelling Postgres accepts, or 400 `validation_failed` (see `normaliseTimeZone`). */
async function resolveTimeZone(db: Db, timeZone: string): Promise<string> {
  const normalised = await normaliseTimeZone(db, timeZone)
  if (normalised !== null) return normalised
  throw badRequest('validation_failed', 'The request is invalid.', {
    issues: [{ path: ['timeZone'], message: 'Must be an IANA time zone such as Europe/Paris.' }]
  })
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23505'
}

/** Creates the user and their first session in one transaction. */
export async function createUser(
  db: Db,
  input: CreateUserInput
): Promise<{ user: UserDto; token: string }> {
  const timeZone = await resolveTimeZone(db, input.timeZone)
  const passwordHash = await hashPassword(input.password)
  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('app_user')
        .values({
          email: input.email.trim(),
          password_hash: passwordHash,
          display_name: input.displayName,
          time_zone: timeZone
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
  const timeZone =
    input.timeZone === undefined ? undefined : await resolveTimeZone(db, input.timeZone)
  const changes = {
    ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
    ...(timeZone !== undefined ? { time_zone: timeZone } : {})
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
