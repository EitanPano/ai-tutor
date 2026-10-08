import { expressionBuilder, sql, type RawBuilder, type SqlBool } from 'kysely'
import { notFound } from './error.js'
import type { Database } from './db/schema.js'

/**
 * THE single ownership helper, and the one definition of a "live" (not soft-deleted) row.
 *
 * Every tenant query goes through `ownedBy` and every "load one row" goes through
 * `requireFound`, so another user's row is indistinguishable from a missing one (404, never 403).
 * `isThreadLive` and `isQuizLive` are the soft-delete predicates every query that reads a thread,
 * or anything derived from one, filters with.
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

// A soft-deleted thread hides everything derived from it: its messages, guides and steps, and the
// quizzes generated from it. These two predicates are the one definition of "live"; both expect
// the thread under the name `thread`.

/**
 * Where-expression: `thread` is not soft-deleted. Usage: `.where(isThreadLive)` in a builder
 * (the column is type-checked there) or `${isThreadLive}` inside a `sql` template.
 */
export const isThreadLive = expressionBuilder<Database, 'thread'>()('thread.deleted_at', 'is', null)

/**
 * Where-expression: `quiz` is live. A topic-only quiz always is; one generated from a thread is
 * live while that thread is. Needs `thread` LEFT JOINed on `quiz.thread_id`.
 */
export const isQuizLive = sql<SqlBool>`(quiz.thread_id IS NULL OR ${isThreadLive})`

/** Returns the row, or throws 404 `not_found` when it is missing or not owned. */
export function requireFound<T>(row: T | undefined | null): T {
  if (row === undefined || row === null) throw notFound()
  return row
}
