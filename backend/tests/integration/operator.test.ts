import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { resetPassword } from '../../src/lib/db/reset-password.js'
import { DEMO_EMAIL, DEMO_PASSWORD, seed } from '../../src/lib/db/seed.js'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp } from '../helper/client.js'

const ctx = createTestApp()
const client = createClient(ctx.app, ctx.config)

beforeEach(() => truncateAll(ctx.db))
afterAll(() => ctx.close())

describe('seed', () => {
  it('creates the demo user once and lets them log in', async () => {
    await seed(ctx.db)
    await seed(ctx.db)
    const users = await ctx.db.selectFrom('app_user').select('email').execute()
    expect(users).toEqual([{ email: DEMO_EMAIL }])
    const res = await client
      .post('/api/session')
      .send({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
    expect(res.status).toBe(200)
  })

  it('refuses to run in production', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      await expect(seed(ctx.db)).rejects.toThrow(/production/)
    } finally {
      process.env.NODE_ENV = previous
    }
  })
})

describe('resetPassword', () => {
  it('sets a new password, ends every session, and invalidates the old password', async () => {
    const { body, cookie } = await signUp(client)
    const temporary = await resetPassword(ctx.db, body.email)
    expect(temporary).toHaveLength(16)

    expect((await client.get('/api/session').set('Cookie', cookie)).status).toBe(401)
    const oldLogin = await client
      .post('/api/session')
      .send({ email: body.email, password: body.password })
    expect(oldLogin.status).toBe(401)
    const newLogin = await client
      .post('/api/session')
      .send({ email: body.email, password: temporary })
    expect(newLogin.status).toBe(200)
  })

  it('returns undefined for an unknown email', async () => {
    expect(await resetPassword(ctx.db, 'nobody@example.com')).toBeUndefined()
  })
})
