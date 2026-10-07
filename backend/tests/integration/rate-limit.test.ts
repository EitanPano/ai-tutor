import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp } from '../helper/client.js'
import { expectContract } from '../helper/contract.js'

const ctx = createTestApp()
const client = createClient(ctx.app, ctx.config)

type ErrorBody = { error: { code: string } }

beforeEach(() => truncateAll(ctx.db))
afterAll(() => ctx.close())

const wrong = (email: string) => client.post('/api/session').send({ email, password: 'wrong-pass' })

describe('login rate limit (AC11)', () => {
  it('answers 429 rate_limited with Retry-After on the sixth attempt within a minute', async () => {
    const { body } = await signUp(client)
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await wrong(body.email)).status).toBe(401)
    }
    const res = await wrong(body.email)
    expect(res.status).toBe(429)
    expect((res.body as ErrorBody).error.code).toBe('rate_limited')
    const retryAfter = Number(res.headers['retry-after'])
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(60)
    expectContract(res, 'post', '/api/session')
  })

  it('blocks even the right password once the limit is hit', async () => {
    const { body } = await signUp(client)
    for (let attempt = 1; attempt <= 5; attempt += 1) await wrong(body.email)
    const res = await client
      .post('/api/session')
      .send({ email: body.email, password: body.password })
    expect(res.status).toBe(429)
  })

  it('counts the same email in any case against one bucket', async () => {
    const { body } = await signUp(client)
    for (let attempt = 1; attempt <= 5; attempt += 1) await wrong(body.email.toUpperCase())
    expect((await wrong(body.email)).status).toBe(429)
  })

  it('does not limit a different email from the same IP', async () => {
    const { body } = await signUp(client)
    for (let attempt = 1; attempt <= 6; attempt += 1) await wrong(body.email)
    const other = await wrong('someone-else@example.com')
    expect(other.status).toBe(401)
  })

  it('stores counters in the rate_limit table', async () => {
    const { body } = await signUp(client)
    await wrong(body.email)
    const rows = await ctx.db.selectFrom('rate_limit').select('key').execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.key).toMatch(/^login:/)
    expect(rows[0]?.key).not.toContain(body.email)
  })
})
