import { describe, expect, it } from 'vitest'
import { createDb } from '../../src/lib/db/index.js'
import { isDbUnavailableError, markPoolConnectError } from '../../src/lib/db/unavailable.js'

const withCode = (code: string) =>
  Object.assign(new Error(`connect ${code} 127.0.0.1:5432`), { code })

const tagged = <T extends Error>(err: T): T => {
  markPoolConnectError(err)
  return err
}

describe('isDbUnavailableError', () => {
  it("recognises pg-pool's connect timeout", () => {
    expect(isDbUnavailableError(tagged(new Error('timeout exceeded when trying to connect')))).toBe(
      true
    )
    expect(
      isDbUnavailableError(tagged(new Error('Connection terminated due to connection timeout')))
    ).toBe(true)
  })

  it('recognises connection errors by code', () => {
    expect(isDbUnavailableError(tagged(withCode('ECONNREFUSED')))).toBe(true)
    expect(isDbUnavailableError(tagged(withCode('ETIMEDOUT')))).toBe(true)
    expect(isDbUnavailableError(tagged(withCode('ENOTFOUND')))).toBe(true)
  })

  it('recognises an AggregateError whose members are connection errors', () => {
    const err = tagged(new AggregateError([withCode('ECONNREFUSED'), withCode('ECONNREFUSED')]))
    expect(isDbUnavailableError(err)).toBe(true)
  })

  it('rejects connection errors that did not come from the pool (e.g. an LLM fetch)', () => {
    expect(isDbUnavailableError(withCode('ECONNREFUSED'))).toBe(false)
    expect(isDbUnavailableError(withCode('ENOTFOUND'))).toBe(false)
    expect(isDbUnavailableError(new Error('timeout exceeded when trying to connect'))).toBe(false)
  })

  it('rejects a pool error that is not a connect failure, and ECONNRESET', () => {
    expect(isDbUnavailableError(tagged(withCode('ECONNRESET')))).toBe(false)
    expect(isDbUnavailableError(tagged(withCode('57014')))).toBe(false)
  })

  it('recognises a real pool connection failure (closed port)', async () => {
    const { db } = createDb('postgres://ai_tutor:ai_tutor@127.0.0.1:1/ai_tutor_test')
    const err = await db
      .selectFrom('app_user')
      .selectAll()
      .execute()
      .then(
        () => null,
        (e: unknown) => e
      )
    await db.destroy()
    expect(err).toBeInstanceOf(Error)
    expect(isDbUnavailableError(err)).toBe(true)
  })

  it('rejects ordinary errors and a cancelled statement (57014)', () => {
    expect(isDbUnavailableError(new Error('secret internal detail'))).toBe(false)
    expect(isDbUnavailableError(withCode('57014'))).toBe(false)
    expect(
      isDbUnavailableError(
        Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
      )
    ).toBe(false)
    expect(isDbUnavailableError(null)).toBe(false)
    expect(isDbUnavailableError('timeout exceeded when trying to connect')).toBe(false)
  })
})
