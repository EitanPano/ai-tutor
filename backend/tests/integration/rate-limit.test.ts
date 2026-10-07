import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp, signUpBody } from '../helper/client.js'
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
    // One counter per limiter: the sign-up, ip + email, and ip alone.
    const keys = rows.map((row) => row.key)
    expect(keys).toHaveLength(3)
    expect(keys.filter((key) => key.startsWith('login:'))).toHaveLength(1)
    expect(keys.filter((key) => key.startsWith('login-ip:'))).toHaveLength(1)
    for (const key of keys) expect(key).not.toContain(body.email)
  })
})

describe('per-IP limits', () => {
  const small = createTestApp({ config: { signupRateLimit: 2, loginIpRateLimit: 3 } })
  const smallClient = createClient(small.app, small.config)

  beforeEach(() => truncateAll(small.db))
  afterAll(() => small.close())

  it('answers 429 rate_limited with Retry-After on the sign-up after the limit, and creates no user', async () => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      expect((await smallClient.post('/api/user').send(signUpBody())).status).toBe(201)
    }
    const res = await smallClient.post('/api/user').send(signUpBody())
    expect(res.status).toBe(429)
    expect((res.body as ErrorBody).error.code).toBe('rate_limited')
    const retryAfter = Number(res.headers['retry-after'])
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(3600)
    expectContract(res, 'post', '/api/user')
    const users = await small.db.selectFrom('app_user').select('id').execute()
    expect(users).toHaveLength(2)
  })

  it('counts a sign-up with an invalid body, because the limiter runs before validation', async () => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await smallClient.post('/api/user').send(signUpBody())
    }
    const res = await smallClient.post('/api/user').send({ email: 'not-an-email' })
    expect(res.status).toBe(429)
  })

  it('limits login attempts with different emails from one IP', async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const res = await smallClient
        .post('/api/session')
        .send({ email: `nobody${attempt}@example.com`, password: 'wrong-pass' })
      expect(res.status).toBe(401)
    }
    const res = await smallClient
      .post('/api/session')
      .send({ email: 'nobody4@example.com', password: 'wrong-pass' })
    expect(res.status).toBe(429)
    expect((res.body as ErrorBody).error.code).toBe('rate_limited')
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    expectContract(res, 'post', '/api/session')
  })

  it('stores the per-IP counters under their own key prefixes', async () => {
    await smallClient.post('/api/user').send(signUpBody())
    await smallClient
      .post('/api/session')
      .send({ email: 'nobody@example.com', password: 'wrong-pass' })
    const keys = (await small.db.selectFrom('rate_limit').select('key').execute()).map((r) => r.key)
    expect(keys.some((key) => key.startsWith('signup:'))).toBe(true)
    expect(keys.some((key) => key.startsWith('login-ip:'))).toBe(true)
    expect(keys.some((key) => key.startsWith('login:'))).toBe(true)
  })
})
