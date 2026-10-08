import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError, fieldInvalid } from '../../src/lib/error.js'
import { atLeastOneField } from '../../src/lib/validation.js'

describe('atLeastOneField', () => {
  const schema = atLeastOneField(z.object({ name: z.string().optional() }))

  it('accepts a body with at least one field', () => {
    expect(schema.safeParse({ name: 'Ada' }).success).toBe(true)
  })

  it('refuses an empty body with the contract message', () => {
    const result = schema.safeParse({})
    expect(result.success).toBe(false)
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: [], message: 'Provide at least one field.' })
    ])
  })
})

describe('fieldInvalid', () => {
  it('builds a 400 validation_failed in the failed-schema issue shape', () => {
    const err = fieldInvalid(['timeZone'], 'Must be an IANA time zone.')
    expect(err).toBeInstanceOf(AppError)
    expect(err.status).toBe(400)
    expect(err.code).toBe('validation_failed')
    expect(err.message).toBe('The request is invalid.')
    expect(err.details).toEqual({
      issues: [{ path: ['timeZone'], message: 'Must be an IANA time zone.' }]
    })
  })
})
