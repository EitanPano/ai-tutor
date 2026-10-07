import { describe, expect, it } from 'vitest'
import { checkoutSuffix, testDatabaseName } from '../helper/test-database-name.js'

const NAME_PATTERN = /^[a-z_][a-z0-9_]*$/

describe('test database names', () => {
  it('is stable for one path and differs between two', () => {
    expect(checkoutSuffix('/work/a')).toBe(checkoutSuffix('/work/a'))
    expect(checkoutSuffix('/work/a')).not.toBe(checkoutSuffix('/work/b'))
  })

  it('builds a short lowercase name the ensureDatabase rule accepts', () => {
    const name = testDatabaseName('ai_tutor_schema_check', '/work/a')
    expect(name).toMatch(NAME_PATTERN)
    expect(name).toMatch(/^ai_tutor_schema_check_[0-9a-f]{8}$/)
    expect(name.length).toBeLessThanOrEqual(63)
  })
})
