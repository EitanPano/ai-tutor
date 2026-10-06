import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'

/** Kysely types mirror the database (snake_case). Later tasks add tables here. */
type CreatedAt = ColumnType<Date, Date | string | undefined, never>

export interface AppUserTable {
  id: Generated<string>
  email: string
  password_hash: string
  display_name: string
  time_zone: string
  created_at: CreatedAt
  deleted_at: Date | null
}

export interface SessionTable {
  id: Generated<string>
  user_id: string
  token_hash: string
  expires_at: Date
  created_at: CreatedAt
}

/** Owned by rate-limiter-flexible; never queried directly by app code. */
export interface RateLimitTable {
  key: string
  points: Generated<number>
  /** Epoch milliseconds. */
  expire: string | null
  created_at: CreatedAt
}

export interface Database {
  app_user: AppUserTable
  session: SessionTable
  rate_limit: RateLimitTable
}

export type AppUserRow = Selectable<AppUserTable>
export type NewAppUser = Insertable<AppUserTable>
export type AppUserUpdate = Updateable<AppUserTable>
export type SessionRow = Selectable<SessionTable>
