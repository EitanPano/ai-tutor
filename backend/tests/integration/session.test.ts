import { sql } from 'kysely'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, truncateAll } from '../helper/app.js'
import { cookieFrom, createClient, signUp, type UserBody } from '../helper/client.js'
import { expectContract, expectSchema } from '../helper/contract.js'

const ctx = createTestApp()
const client = createClient(ctx.app, ctx.config)

type ErrorBody = { error: { code: string; message: string }; requestId: string }

beforeEach(() => truncateAll(ctx.db))
afterAll(() => ctx.close())

async function expiresAtOf(cookie: string): Promise<Date> {
  const sid = cookie.slice('sid='.length)
  const { createHash } = await import('node:crypto')
  const hash = createHash('sha256').update(sid).digest('hex')
  const { rows } = await sql<{
    expires_at: Date
  }>`SELECT expires_at FROM session WHERE token_hash = ${hash}`.execute(ctx.db)
  const row = rows[0]
  if (!row) throw new Error('session row not found')
  return row.expires_at
}

describe('session lifecycle (AC02)', () => {
  it('signs up, reads the session, logs out, is rejected, and logs in again', async () => {
    const { user, body, cookie } = await signUp(client)

    const me = await client.get('/api/session').set('Cookie', cookie)
    expect(me.status).toBe(200)
    expect((me.body as { user: UserBody }).user).toEqual(user)
    expectContract(me, 'get', '/api/session')

    const out = await client.delete('/api/session').set('Cookie', cookie)
    expect(out.status).toBe(204)
    expectContract(out, 'delete', '/api/session')
    expect((out.headers['set-cookie'] as unknown as string[])[0]).toMatch(/^sid=;/)

    const after = await client.get('/api/session').set('Cookie', cookie)
    expect(after.status).toBe(401)
    expect((after.body as ErrorBody).error.code).toBe('unauthenticated')
    expectContract(after, 'get', '/api/session')
    expectSchema(after.body, 'ErrorResponse')

    const login = await client
      .post('/api/session')
      .send({ email: body.email, password: body.password })
    expect(login.status).toBe(200)
    expect((login.body as { user: UserBody }).user.id).toBe(user.id)
    expectContract(login, 'post', '/api/session')

    const again = await client.get('/api/session').set('Cookie', cookieFrom(login))
    expect(again.status).toBe(200)
  })

  it('matches the email case-insensitively on login', async () => {
    const { body } = await signUp(client)
    const res = await client
      .post('/api/session')
      .send({ email: body.email.toUpperCase(), password: body.password })
    expect(res.status).toBe(200)
  })

  it('answers 401 without a cookie and does not set one', async () => {
    const res = await client.get('/api/session')
    expect(res.status).toBe(401)
    expect(res.headers['set-cookie']).toBeUndefined()
    expectContract(res, 'get', '/api/session')
  })

  it('answers 401 and clears a stale sid cookie', async () => {
    const res = await client.get('/api/session').set('Cookie', 'sid=not-a-real-token')
    expect(res.status).toBe(401)
    const setCookie = res.headers['set-cookie'] as unknown as string[]
    expect(setCookie[0]).toMatch(/^sid=;/)
    expect(setCookie[0]).toMatch(/Expires=Thu, 01 Jan 1970/)
    expectContract(res, 'get', '/api/session')
  })

  it('rejects an expired session', async () => {
    const { cookie } = await signUp(client)
    await sql`UPDATE session SET expires_at = now() - interval '1 minute'`.execute(ctx.db)
    const res = await client.get('/api/session').set('Cookie', cookie)
    expect(res.status).toBe(401)
  })

  it('rejects the session of a soft-deleted user', async () => {
    const { cookie } = await signUp(client)
    await sql`UPDATE app_user SET deleted_at = now()`.execute(ctx.db)
    const res = await client.get('/api/session').set('Cookie', cookie)
    expect(res.status).toBe(401)
  })

  it('does not let a soft-deleted user log in', async () => {
    const { body } = await signUp(client)
    await sql`UPDATE app_user SET deleted_at = now()`.execute(ctx.db)
    const res = await client
      .post('/api/session')
      .send({ email: body.email, password: body.password })
    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('invalid_credentials')
  })
})

describe('login failures', () => {
  it('rejects a wrong password with 401 invalid_credentials', async () => {
    const { body } = await signUp(client)
    const res = await client.post('/api/session').send({ email: body.email, password: 'nope-nope' })
    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('invalid_credentials')
    expect(res.headers['set-cookie']).toBeUndefined()
    expectContract(res, 'post', '/api/session')
  })

  it('gives an unknown email the same 401 body as a wrong password', async () => {
    const { body } = await signUp(client)
    const wrong = await client
      .post('/api/session')
      .send({ email: body.email, password: 'nope-nope' })
    const unknown = await client
      .post('/api/session')
      .send({ email: 'nobody@example.com', password: 'nope-nope' })
    expect(unknown.status).toBe(401)
    expect((unknown.body as ErrorBody).error).toEqual((wrong.body as ErrorBody).error)
  })

  it('rejects a malformed login email with 400 validation_failed', async () => {
    const res = await client.post('/api/session').send({ email: 'not-an-email', password: 'x' })
    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('validation_failed')
    expectContract(res, 'post', '/api/session')
  })
})

describe('session cookie', () => {
  it('is HttpOnly and SameSite=Lax, and not Secure outside production', async () => {
    const res = await client.post('/api/user').send({
      email: 'cookie@example.com',
      password: 'correct-horse-battery',
      displayName: 'Cookie',
      timeZone: 'UTC'
    })
    const setCookie = (res.headers['set-cookie'] as unknown as string[])[0] as string
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).not.toContain('Secure')
  })

  it('rotates on login: the previous cookie stops working', async () => {
    const { body, cookie: oldCookie } = await signUp(client)
    const login = await client
      .post('/api/session')
      .set('Cookie', oldCookie)
      .send({ email: body.email, password: body.password })
    expect(login.status).toBe(200)
    const newCookie = cookieFrom(login)
    expect(newCookie).not.toBe(oldCookie)

    expect((await client.get('/api/session').set('Cookie', oldCookie)).status).toBe(401)
    expect((await client.get('/api/session').set('Cookie', newCookie)).status).toBe(200)
  })

  it('slides the expiry of a session close to expiring and re-sends the cookie', async () => {
    const { cookie } = await signUp(client)
    await sql`UPDATE session SET expires_at = now() + interval '1 day'`.execute(ctx.db)
    const res = await client.get('/api/session').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect((res.headers['set-cookie'] as unknown as string[])[0]).toContain(cookie)
    const days = (Date.parse((await expiresAtOf(cookie)).toISOString()) - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(29.9)
    expect(days).toBeLessThanOrEqual(30)
  })

  it('does not write or re-send a cookie for a freshly extended session', async () => {
    const { cookie } = await signUp(client)
    const before = await expiresAtOf(cookie)
    const res = await client.get('/api/session').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.headers['set-cookie']).toBeUndefined()
    expect((await expiresAtOf(cookie)).getTime()).toBe(before.getTime())
  })
})

describe('logout failures', () => {
  it('answers 401 for DELETE without a session', async () => {
    const res = await client.delete('/api/session')
    expect(res.status).toBe(401)
    expectContract(res, 'delete', '/api/session')
  })
})
