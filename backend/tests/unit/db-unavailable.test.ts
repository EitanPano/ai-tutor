import { describe, expect, it } from 'vitest'
import { isDbUnavailableError } from '../../src/lib/db/unavailable.js'

const withCode = (code: string) =>
  Object.assign(new Error(`connect ${code} 127.0.0.1:5432`), { code })

describe('isDbUnavailableError', () => {
  it("recognises pg-pool's connect timeout", () => {
    expect(isDbUnavailableError(new Error('timeout exceeded when trying to connect'))).toBe(true)
    expect(isDbUnavailableError(new Error('Connection terminated due to connection timeout'))).toBe(
      true
    )
  })

  it('recognises connection errors by code', () => {
    expect(isDbUnavailableError(withCode('ECONNREFUSED'))).toBe(true)
    expect(isDbUnavailableError(withCode('ETIMEDOUT'))).toBe(true)
    expect(isDbUnavailableError(withCode('ENOTFOUND'))).toBe(true)
  })

  it('recognises an AggregateError whose members are connection errors', () => {
    const err = new AggregateError([withCode('ECONNREFUSED'), withCode('ECONNREFUSED')])
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
