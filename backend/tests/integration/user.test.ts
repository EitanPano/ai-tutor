import { sql } from 'kysely'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp, signUpBody, type UserBody } from '../helper/client.js'
import { expectContract } from '../helper/contract.js'

const ctx = createTestApp()
const client = createClient(ctx.app, ctx.config)

type ErrorBody = {
  error: {
    code: string
    message: string
    details?: { issues: { path: unknown[] }[]; nextChangeAt?: string }
  }
}

beforeEach(() => truncateAll(ctx.db))
afterAll(() => ctx.close())

describe('POST /api/user', () => {
  it('creates the user, signs them in, and never returns the password hash', async () => {
    const body = signUpBody()
    const res = await client.post('/api/user').send(body)
    expect(res.status).toBe(201)
    expectContract(res, 'post', '/api/user')
    const { user } = res.body as { user: UserBody }
    expect(user).toMatchObject({
      email: body.email,
      displayName: 'Test User',
      timeZone: 'Europe/Paris'
    })
    expect(res.text).not.toMatch(/hash|argon2|password/i)
    expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(/^sid=/)
  })

  it('stores an argon2id hash, not the password', async () => {
    const { body } = await signUp(client)
    const row = await ctx.db
      .selectFrom('app_user')
      .select('password_hash')
      .where('email', '=', body.email)
      .executeTakeFirstOrThrow()
    expect(row.password_hash).toMatch(/^\$argon2id\$/)
    expect(row.password_hash).not.toContain(body.password)
  })

  it('rejects a duplicate email in any case with 409 email_taken', async () => {
    const { body } = await signUp(client)
    const res = await client.post('/api/user').send({ ...body, email: body.email.toUpperCase() })
    expect(res.status).toBe(409)
    expect((res.body as ErrorBody).error.code).toBe('email_taken')
    expectContract(res, 'post', '/api/user')
  })

  it('does not leave a user or session behind when signup fails', async () => {
    const { body } = await signUp(client)
    await client.post('/api/user').send(body)
    const users = await ctx.db.selectFrom('app_user').select('id').execute()
    const sessions = await ctx.db.selectFrom('session').select('id').execute()
    expect(users).toHaveLength(1)
    expect(sessions).toHaveLength(1)
  })

  it.each([
    ['missing password', { password: undefined }, 'password'],
    ['short password', { password: 'short' }, 'password'],
    ['invalid email', { email: 'not-an-email' }, 'email'],
    ['empty display name', { displayName: '' }, 'displayName'],
    ['unknown field', { admin: true }, undefined]
  ])('rejects %s with 400 validation_failed and details', async (_name, overrides, field) => {
    const res = await client.post('/api/user').send(signUpBody(overrides))
    expect(res.status).toBe(400)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('validation_failed')
    expect(body.error.details?.issues.length).toBeGreaterThan(0)
    if (field) {
      expect(body.error.details?.issues.some((issue) => issue.path.includes(field))).toBe(true)
    }
    expectContract(res, 'post', '/api/user')
  })

  it('rejects an unknown time zone with 400 validation_failed', async () => {
    const res = await client.post('/api/user').send(signUpBody({ timeZone: 'Mars/Olympus' }))
    expect(res.status).toBe(400)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('validation_failed')
    expect(body.error.details?.issues[0]?.path).toEqual(['timeZone'])
    expectContract(res, 'post', '/api/user')
  })
})

describe('PATCH /api/user', () => {
  it('updates the display name and time zone', async () => {
    const { user, cookie } = await signUp(client)
    const res = await client
      .patch('/api/user')
      .set('Cookie', cookie)
      .send({ displayName: 'New Name', timeZone: 'America/New_York' })
    expect(res.status).toBe(200)
    expectContract(res, 'patch', '/api/user')
    expect((res.body as { user: UserBody }).user).toEqual({
      ...user,
      displayName: 'New Name',
      timeZone: 'America/New_York'
    })
  })

  it('updates a single field and leaves the other alone', async () => {
    const { user, cookie } = await signUp(client)
    const res = await client.patch('/api/user').set('Cookie', cookie).send({ displayName: 'Only' })
    expect((res.body as { user: UserBody }).user).toEqual({ ...user, displayName: 'Only' })
  })

  it('rejects an empty body with 400 validation_failed', async () => {
    const { cookie } = await signUp(client)
    const res = await client.patch('/api/user').set('Cookie', cookie).send({})
    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('validation_failed')
    expectContract(res, 'patch', '/api/user')
  })

  it('rejects an invalid time zone with 400', async () => {
    const { cookie } = await signUp(client)
    const res = await client
      .patch('/api/user')
      .set('Cookie', cookie)
      .send({ timeZone: 'Nope/Zone' })
    expect(res.status).toBe(400)
    expectContract(res, 'patch', '/api/user')
  })

  describe('time zone change limit', () => {
    const patchZone = (cookie: string, timeZone: string) =>
      client.patch('/api/user').set('Cookie', cookie).send({ timeZone })

    it('allows the first change after sign-up, then refuses another within 24 hours', async () => {
      const { cookie } = await signUp(client)
      const first = await patchZone(cookie, 'America/New_York')
      expect(first.status).toBe(200)
      expectContract(first, 'patch', '/api/user')

      const second = await patchZone(cookie, 'Asia/Tokyo')
      expect(second.status).toBe(409)
      expectContract(second, 'patch', '/api/user')
      const { error } = second.body as ErrorBody
      expect(error.code).toBe('time_zone_recently_changed')
      expect(error.message).toBe('You can change your time zone once a day. Try again later.')
      const next = new Date(error.details?.nextChangeAt as string)
      const wait = next.getTime() - Date.now()
      expect(wait).toBeGreaterThan(23.9 * 3_600_000)
      expect(wait).toBeLessThanOrEqual(24 * 3_600_000)

      const row = await ctx.db.selectFrom('app_user').select('time_zone').executeTakeFirst()
      expect(row?.time_zone).toBe('America/New_York')
    })

    it('treats re-sending the current zone as no change, even spelled differently', async () => {
      const { cookie } = await signUp(client)
      expect((await patchZone(cookie, 'America/New_York')).status).toBe(200)
      expect((await patchZone(cookie, 'America/New_York')).status).toBe(200)
      expect((await patchZone(cookie, 'america/new_york')).status).toBe(200)
      // The same-zone saves are not changes: the window is still the first change's.
      expect((await patchZone(cookie, 'Asia/Tokyo')).status).toBe(409)
    })

    it('does not stamp a same-zone save', async () => {
      const { cookie } = await signUp(client)
      expect((await patchZone(cookie, 'Europe/Paris')).status).toBe(200)
      const row = await ctx.db
        .selectFrom('app_user')
        .select('time_zone_changed_at')
        .executeTakeFirst()
      expect(row?.time_zone_changed_at).toBeNull()
      // Still the first change, so it is allowed.
      expect((await patchZone(cookie, 'Asia/Tokyo')).status).toBe(200)
    })

    it('allows a change once the window has passed', async () => {
      const { cookie } = await signUp(client)
      expect((await patchZone(cookie, 'America/New_York')).status).toBe(200)
      await sql`UPDATE app_user SET time_zone_changed_at = now() - interval '24 hours 1 minute'`.execute(
        ctx.db
      )
      const res = await patchZone(cookie, 'Asia/Tokyo')
      expect(res.status).toBe(200)
      expect((res.body as { user: UserBody }).user.timeZone).toBe('Asia/Tokyo')
    })

    it('saves a new display name while re-sending the same zone, inside the window', async () => {
      const { user, cookie } = await signUp(client)
      expect((await patchZone(cookie, 'America/New_York')).status).toBe(200)
      const res = await client
        .patch('/api/user')
        .set('Cookie', cookie)
        .send({ displayName: 'Renamed', timeZone: 'America/New_York' })
      expect(res.status).toBe(200)
      expect((res.body as { user: UserBody }).user).toEqual({
        ...user,
        displayName: 'Renamed',
        timeZone: 'America/New_York'
      })
    })

    it('refuses a rename bundled with a blocked zone change, saving neither', async () => {
      const { user, cookie } = await signUp(client)
      expect((await patchZone(cookie, 'America/New_York')).status).toBe(200)
      const res = await client
        .patch('/api/user')
        .set('Cookie', cookie)
        .send({ displayName: 'Renamed', timeZone: 'Asia/Tokyo' })
      expect(res.status).toBe(409)
      const row = await ctx.db.selectFrom('app_user').select('display_name').executeTakeFirst()
      expect(row?.display_name).toBe(user.displayName)
    })

    it('updates a display name alone inside the window', async () => {
      const { cookie } = await signUp(client)
      expect((await patchZone(cookie, 'America/New_York')).status).toBe(200)
      const res = await client
        .patch('/api/user')
        .set('Cookie', cookie)
        .send({ displayName: 'Solo' })
      expect(res.status).toBe(200)
    })
  })

  it('answers 401 without a cookie', async () => {
    const res = await client.patch('/api/user').send({ displayName: 'x' })
    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('unauthenticated')
    expectContract(res, 'patch', '/api/user')
  })
})
