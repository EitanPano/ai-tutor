import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql
} from 'kysely'
import { describe, expect, it } from 'vitest'
import type { Database } from '../../src/lib/db/schema.js'
import { isQuizLive, isThreadLive, ownedBy, requireFound } from '../../src/lib/ownership.js'

const db = new Kysely<Database>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (kysely) => new PostgresIntrospector(kysely),
    createQueryCompiler: () => new PostgresQueryCompiler()
  }
})

describe('ownedBy', () => {
  it('scopes a query to the signed-in user with a bound parameter', () => {
    const query = db
      .selectFrom('session')
      .selectAll()
      .where(ownedBy('session', { userId: 'user-1' }))
      .compile()
    expect(query.sql).toBe('select * from "session" where "session"."user_id" = $1')
    expect(query.parameters).toEqual(['user-1'])
  })

  it('never inlines the user id into the SQL text', () => {
    const query = db
      .selectFrom('session')
      .selectAll()
      .where(ownedBy('session', { userId: "x' OR '1'='1" }))
      .compile()
    expect(query.sql).not.toContain('OR')
    expect(query.parameters).toEqual(["x' OR '1'='1"])
  })
})

describe('requireFound', () => {
  it('returns the row when present', () => {
    const row = { id: '1' }
    expect(requireFound(row)).toBe(row)
  })

  it.each([undefined, null])('throws 404 not_found for %s', (missing) => {
    expect(() => requireFound(missing)).toThrowError(
      expect.objectContaining({ status: 404, code: 'not_found' }) as Error
    )
  })
})

describe('isThreadLive', () => {
  it('filters a builder query on the thread soft-delete column', () => {
    const query = db.selectFrom('thread').select('id').where(isThreadLive).compile()
    expect(query.sql).toBe('select "id" from "thread" where "thread"."deleted_at" is null')
  })

  it('interpolates into a sql template, alone and inside isQuizLive', () => {
    expect(sql`WHERE ${isThreadLive}`.compile(db).sql).toBe('WHERE "thread"."deleted_at" is null')
    expect(sql`WHERE ${isQuizLive}`.compile(db).sql).toBe(
      'WHERE (quiz.thread_id IS NULL OR "thread"."deleted_at" is null)'
    )
  })
})
