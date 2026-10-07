import { describe, expect, it } from 'vitest'
import { createSessionToken, hashSessionToken } from '../../src/lib/session-token.js'

describe('session token', () => {
  it('creates 32 random bytes as base64url', () => {
    const token = createSessionToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
  })

  it('creates a different token every time', () => {
    expect(createSessionToken()).not.toBe(createSessionToken())
  })

  it('hashes to SHA-256 hex, deterministically', () => {
    expect(hashSessionToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
    expect(hashSessionToken('abc')).toBe(hashSessionToken('abc'))
    expect(hashSessionToken('abd')).not.toBe(hashSessionToken('abc'))
  })
})
