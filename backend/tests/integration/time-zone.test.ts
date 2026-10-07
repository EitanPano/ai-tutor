import { sql } from 'kysely'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { LEGACY_TIME_ZONE, normaliseTimeZone } from '../../src/lib/time-zone.js'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp, signUpBody, type UserBody } from '../helper/client.js'
import { expectContract } from '../helper/contract.js'

const ctx = createTestApp()
const client = createClient(ctx.app, ctx.config)

beforeEach(() => truncateAll(ctx.db))
afterAll(() => ctx.close())

async function postgresNames(): Promise<Set<string>> {
  const { rows } = await sql<{ name: string }>`SELECT name FROM pg_timezone_names`.execute(ctx.db)
  return new Set(rows.map((row) => row.name))
}

describe('normaliseTimeZone', () => {
  // Exhaustive database sweep: its duration depends on the machine, so it gets its own budget.
  it('maps every Intl time zone to a name Postgres accepts', async () => {
    const known = await postgresNames()
    const names = Intl.supportedValuesOf('timeZone')
    const legacy = names.filter((name) => !known.has(name))
    // Guards the premise: this runtime really does emit names Postgres rejects.
    expect(legacy.length).toBeGreaterThan(0)
    // One pg_timezone_names scan per zone (~420): run them through the pool, not one by one.
    const results = await Promise.all(
      names.map(async (name) => ({ name, normalised: await normaliseTimeZone(ctx.db, name) }))
    )
    for (const { name, normalised } of results) {
      expect(normalised, name).not.toBeNull()
      expect(known.has(normalised as string), `${name} -> ${normalised}`).toBe(true)
    }
    // Every legacy alias in the table resolves, and every name V8 emits is covered by it.
    for (const name of legacy) expect(LEGACY_TIME_ZONE[name], name).toBeDefined()
    for (const modern of Object.values(LEGACY_TIME_ZONE))
      expect(known.has(modern), modern).toBe(true)
  }, 30_000)

  it('uses the Postgres spelling for a differently-cased name', async () => {
    expect(await normaliseTimeZone(ctx.db, 'europe/paris')).toBe('Europe/Paris')
    expect(await normaliseTimeZone(ctx.db, 'asia/calcutta')).toBe('Asia/Kolkata')
  })

  it('accepts UTC and rejects offsets and unknown names', async () => {
    expect(await normaliseTimeZone(ctx.db, 'UTC')).toBe('UTC')
    for (const bad of [
      '+01:00',
      '-05:00',
      '+1',
      '-0500',
      '01:00',
      'GMT+1',
      'Mars/Olympus',
      '../x'
    ]) {
      expect(await normaliseTimeZone(ctx.db, bad), bad).toBeNull()
    }
  })
})

describe('time zone on the API', () => {
  it('stores the Postgres spelling when a user signs up with Asia/Calcutta', async () => {
    const res = await client.post('/api/user').send(signUpBody({ timeZone: 'Asia/Calcutta' }))
    expect(res.status).toBe(201)
    expectContract(res, 'post', '/api/user')
    expect((res.body as { user: UserBody }).user.timeZone).toBe('Asia/Kolkata')
  })

  it('rejects offset-style ids on signup and on PATCH with 400 validation_failed', async () => {
    const { cookie } = await signUp(client)
    for (const timeZone of ['+01:00', '-05:00']) {
      const signup = await client.post('/api/user').send(signUpBody({ timeZone }))
      expect(signup.status, timeZone).toBe(400)
      expect((signup.body as { error: { code: string } }).error.code).toBe('validation_failed')
      const patch = await client.patch('/api/user').set('Cookie', cookie).send({ timeZone })
      expect(patch.status, timeZone).toBe(400)
      expectContract(patch, 'patch', '/api/user')
    }
  })

  it('round-trips a legacy name saved from the profile', async () => {
    const { cookie } = await signUp(client)
    const res = await client
      .patch('/api/user')
      .set('Cookie', cookie)
      .send({ timeZone: 'Europe/Kiev' })
    expect(res.status).toBe(200)
    expect((res.body as { user: UserBody }).user.timeZone).toBe('Europe/Kyiv')
  })

  it('serves progress and an ask for a user who signed up with Asia/Calcutta', async () => {
    const { cookie } = await signUp(client, { timeZone: 'Asia/Calcutta' })
    const progress = await client.get('/api/progress').set('Cookie', cookie)
    expect(progress.status).toBe(200)
    expectContract(progress, 'get', '/api/progress')
    const thread = await client.post('/api/thread').set('Cookie', cookie).send({ topicId: 'react' })
    const id = (thread.body as { thread: { id: string } }).thread.id
    const ask = await client
      .post(`/api/thread/${id}/message`)
      .set('Cookie', cookie)
      .send({ content: 'hello' })
    expect(ask.status).toBe(200)
    expect(ask.text).toContain('event: message.complete')
  })
})
