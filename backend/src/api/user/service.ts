import { sql } from 'kysely'
import type { Db } from '../../lib/db/index.js'
import { conflict, fieldInvalid } from '../../lib/error.js'
import { hashPassword } from '../../lib/password.js'
import { normaliseTimeZone } from '../../lib/time-zone.js'
import { requireFound, type Auth } from '../../lib/ownership.js'
import { startSession } from './session.service.js'
import { toUserDto, type UserDto } from './dto.js'

/** A time-zone change moves the daily AI budget window, so it is limited to one per this window. */
const TIME_ZONE_CHANGE_WINDOW_HOURS = 24

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
  throw fieldInvalid(['timeZone'], 'Must be an IANA time zone such as Europe/Paris.')
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23505'
}

async function getUser(db: Db, auth: Auth): Promise<UserDto> {
  const row = await db
    .selectFrom('app_user')
    .selectAll()
    .where('id', '=', auth.userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst()
  return toUserDto(requireFound(row))
}

type UserServiceDeps = { db: Db }

export type UserService = {
  /** Creates the user and their first session in one transaction. */
  create(input: CreateUserInput): Promise<{ user: UserDto; token: string }>
  get(auth: Auth): Promise<UserDto>
  update(auth: Auth, input: { displayName?: string; timeZone?: string }): Promise<UserDto>
}

export function createUserService({ db }: UserServiceDeps): UserService {
  return {
    async create(input) {
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
    },

    get(auth) {
      return getUser(db, auth)
    },

    async update(auth, input) {
      const timeZone =
        input.timeZone === undefined ? undefined : await resolveTimeZone(db, input.timeZone)
      const changes = {
        ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
        ...(timeZone !== undefined
          ? {
              time_zone: timeZone,
              // SET expressions see the old row: stamp only when the zone really changes.
              time_zone_changed_at: sql<Date | null>`CASE WHEN time_zone <> ${timeZone} THEN now() ELSE time_zone_changed_at END`
            }
          : {})
      }
      if (Object.keys(changes).length === 0) return getUser(db, auth)
      let query = db
        .updateTable('app_user')
        .set(changes)
        .where('id', '=', auth.userId)
        .where('deleted_at', 'is', null)
      // One conditional UPDATE, like the generation lock, so two concurrent changes cannot both pass.
      if (timeZone !== undefined) {
        query = query.where(
          sql<boolean>`(time_zone = ${timeZone} OR time_zone_changed_at IS NULL OR time_zone_changed_at <= now() - make_interval(hours => ${TIME_ZONE_CHANGE_WINDOW_HOURS}))`
        )
      }
      const row = await query.returningAll().executeTakeFirst()
      if (row) return toUserDto(row)
      // No row: the user is gone, or the change came too soon.
      const current = await db
        .selectFrom('app_user')
        .select(
          sql<Date>`time_zone_changed_at + make_interval(hours => ${TIME_ZONE_CHANGE_WINDOW_HOURS})`.as(
            'next'
          )
        )
        .where('id', '=', auth.userId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()
      const { next } = requireFound(current)
      throw conflict(
        'time_zone_recently_changed',
        'You can change your time zone once a day. Try again later.',
        { nextChangeAt: next.toISOString() }
      )
    }
  }
}
