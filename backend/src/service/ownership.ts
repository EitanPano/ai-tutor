import { sql, type RawBuilder, type SqlBool } from 'kysely'
import { notFound } from '../lib/error.js'
import type { Database } from '../lib/db/schema.js'

/**
 * THE single ownership helper. Every tenant query goes through `ownedBy` and every
 * "load one row" goes through `requireFound`, so another user's row is indistinguishable
 * from a missing one (404, never 403).
 *
 * Tenancy is per user today. Adding `orgId` later changes this file only: extend `Auth` and
 * the predicate in `ownedBy`; services and routes keep passing `auth` unchanged.
 */
export type Auth = { userId: string }

/** Tables that carry a `user_id` column. */
export type TenantTable = {
  [T in keyof Database]: Database[T] extends { user_id: string } ? T : never
}[keyof Database]

/** Where-expression `<table>.user_id = auth.userId`. Usage: `.where(ownedBy('thread', auth))`. */
export function ownedBy(table: TenantTable, auth: Auth): RawBuilder<SqlBool> {
  return sql<SqlBool>`${sql.ref(`${table}.user_id`)} = ${auth.userId}`
}

/** Returns the row, or throws 404 `not_found` when it is missing or not owned. */
export function requireFound<T>(row: T | undefined | null): T {
  if (row === undefined || row === null) throw notFound()
  return row
}
