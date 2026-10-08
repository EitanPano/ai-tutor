import { describe, expect, it, vi } from 'vitest'

const hashPassword = vi.hoisted(() => vi.fn(() => Promise.resolve('hash')))
vi.mock('../../src/lib/password.js', () => ({ doesPasswordMatch: vi.fn(), hashPassword }))

describe('warmDummyHash', () => {
  it('computes the dummy hash once, up front', async () => {
    const { warmDummyHash } = await import('../../src/api/user/session.service.js')
    warmDummyHash()
    warmDummyHash()
    await Promise.resolve()
    expect(hashPassword).toHaveBeenCalledTimes(1)
  })
})
