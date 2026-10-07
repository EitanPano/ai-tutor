import { sql } from 'kysely'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp } from '../helper/client.js'
import { expectContract } from '../helper/contract.js'

const ctx = createTestApp()
const client = createClient(ctx.app, ctx.config)

type ThreadBody = {
  id: string
  topicId: string
  title: string
  messageCount: number
  createdAt: string
  updatedAt: string
}
type ErrorBody = {
  error: { code: string; details?: { issues: { path: unknown[]; message: string }[] } }
}

beforeEach(() => truncateAll(ctx.db))
afterAll(() => ctx.close())

async function newThread(cookie: string, body: Record<string, unknown> = {}) {
  const res = await client.post('/api/thread').set('Cookie', cookie).send(body)
  expect(res.status).toBe(201)
  return (res.body as { thread: ThreadBody }).thread
}

describe('POST /api/thread', () => {
  it('creates a thread with the defaults', async () => {
    const { cookie } = await signUp(client)
    const res = await client.post('/api/thread').set('Cookie', cookie).send({})
    expect(res.status).toBe(201)
    expectContract(res, 'post', '/api/thread')
    expect((res.body as { thread: ThreadBody }).thread).toMatchObject({
      topicId: 'other',
      title: 'New thread',
      messageCount: 0
    })
  })

  it('creates a thread with a topic and a title', async () => {
    const { cookie } = await signUp(client)
    const thread = await newThread(cookie, { topicId: 'react', title: 'Hooks' })
    expect(thread).toMatchObject({ topicId: 'react', title: 'Hooks' })
  })

  it('rejects an unknown topic with 400 validation_failed and details', async () => {
    const { cookie } = await signUp(client)
    const res = await client.post('/api/thread').set('Cookie', cookie).send({ topicId: 'cobol' })
    expect(res.status).toBe(400)
    expectContract(res, 'post', '/api/thread')
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('validation_failed')
    expect(body.error.details?.issues[0]).toEqual({ path: ['topicId'], message: 'Unknown topic' })
  })

  it('rejects an empty title, an unknown field and an oversized body', async () => {
    const { cookie } = await signUp(client)
    const empty = await client.post('/api/thread').set('Cookie', cookie).send({ title: '' })
    expect(empty.status).toBe(400)
    expectContract(empty, 'post', '/api/thread')
    const extra = await client.post('/api/thread').set('Cookie', cookie).send({ nope: 1 })
    expect(extra.status).toBe(400)
    const big = await client
      .post('/api/thread')
      .set('Cookie', cookie)
      .send({ title: 'x'.repeat(300_000) })
    expect(big.status).toBe(413)
    expectContract(big, 'post', '/api/thread')
  })

  it('answers 401 without a session and 403 for a foreign Origin', async () => {
    const anon = await client.post('/api/thread').send({})
    expect(anon.status).toBe(401)
    expectContract(anon, 'post', '/api/thread')
    const { cookie } = await signUp(client)
    const foreign = await client
      .post('/api/thread')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .send({})
    expect(foreign.status).toBe(403)
    expectContract(foreign, 'post', '/api/thread')
  })
})

describe('GET /api/thread', () => {
  it('pages across three pages with limit=2, newest first, without duplicates', async () => {
    const { cookie } = await signUp(client)
    const ids: string[] = []
    for (let i = 0; i < 5; i += 1) ids.push((await newThread(cookie, { title: `t${i}` })).id)
    // Give every thread a distinct, microsecond-precise updated_at in a known order.
    for (const [index, id] of ids.entries()) {
      await sql`UPDATE thread SET updated_at = timestamptz '2026-01-01 00:00:00.123456+00' + ${index} * interval '1 second' WHERE id = ${id}`.execute(
        ctx.db
      )
    }
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const url: string = `/api/thread?limit=2${cursor ? `&cursor=${cursor}` : ''}`
      const res = await client.get(url).set('Cookie', cookie)
      expect(res.status).toBe(200)
      expectContract(res, 'get', '/api/thread')
      const body = res.body as { threads: ThreadBody[]; nextCursor: string | null }
      seen.push(...body.threads.map((thread) => thread.id))
      cursor = body.nextCursor
      pages += 1
    } while (cursor)
    expect(pages).toBe(3)
    expect(seen).toEqual([...ids].reverse())
  })

  it('does not repeat a row whose updated_at has microseconds', async () => {
    const { cookie } = await signUp(client)
    const ids = [(await newThread(cookie)).id, (await newThread(cookie)).id]
    await sql`UPDATE thread SET updated_at = timestamptz '2026-01-01 00:00:00.123456+00'`.execute(
      ctx.db
    )
    const first = await client.get('/api/thread?limit=1').set('Cookie', cookie)
    const body = first.body as { threads: ThreadBody[]; nextCursor: string }
    const second = await client
      .get(`/api/thread?limit=1&cursor=${body.nextCursor}`)
      .set('Cookie', cookie)
    const secondBody = second.body as { threads: ThreadBody[]; nextCursor: string | null }
    // Tied updated_at: id descending breaks the tie, and no row appears twice.
    expect([body.threads[0]?.id, secondBody.threads[0]?.id]).toEqual([...ids].sort().reverse())
    expect(secondBody.nextCursor).toBeNull()
  })

  it('only lists the signed-in user threads and hides deleted ones', async () => {
    const a = await signUp(client)
    const b = await signUp(client)
    const mine = await newThread(a.cookie)
    const gone = await newThread(a.cookie)
    await newThread(b.cookie)
    await client.delete(`/api/thread/${gone.id}`).set('Cookie', a.cookie)
    const res = await client.get('/api/thread').set('Cookie', a.cookie)
    const body = res.body as { threads: ThreadBody[]; nextCursor: string | null }
    expect(body.threads.map((thread) => thread.id)).toEqual([mine.id])
    expect(body.nextCursor).toBeNull()
  })

  it.each(['not-base64-json', 'e30', Buffer.from('{"u":"nope","i":"x"}').toString('base64url')])(
    'rejects the bad cursor %s with 400',
    async (cursor) => {
      const { cookie } = await signUp(client)
      const res = await client.get(`/api/thread?cursor=${cursor}`).set('Cookie', cookie)
      expect(res.status).toBe(400)
      expectContract(res, 'get', '/api/thread')
      expect((res.body as ErrorBody).error.code).toBe('validation_failed')
    }
  )

  it.each(['0', '51', 'abc'])('rejects limit=%s with 400', async (limit) => {
    const { cookie } = await signUp(client)
    const res = await client.get(`/api/thread?limit=${limit}`).set('Cookie', cookie)
    expect(res.status).toBe(400)
    expectContract(res, 'get', '/api/thread')
  })

  it('answers 401 without a session', async () => {
    const res = await client.get('/api/thread')
    expect(res.status).toBe(401)
    expectContract(res, 'get', '/api/thread')
  })
})

describe('GET /api/thread/:id', () => {
  it('returns the thread with empty messages, guides and quizzes', async () => {
    const { cookie } = await signUp(client)
    const thread = await newThread(cookie)
    const res = await client.get(`/api/thread/${thread.id}`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expectContract(res, 'get', '/api/thread/{id}')
    expect(res.body).toEqual({ thread, messages: [], guides: [], quizzes: [] })
  })

  it('answers 404 for an unknown id', async () => {
    const { cookie } = await signUp(client)
    const res = await client.get('/api/thread/nope').set('Cookie', cookie)
    expect(res.status).toBe(404)
    expectContract(res, 'get', '/api/thread/{id}')
  })
})

describe('PATCH /api/thread/:id', () => {
  it('renames and re-topics a thread', async () => {
    const { cookie } = await signUp(client)
    const thread = await newThread(cookie)
    const res = await client
      .patch(`/api/thread/${thread.id}`)
      .set('Cookie', cookie)
      .send({ title: 'Renamed', topicId: 'sql' })
    expect(res.status).toBe(200)
    expectContract(res, 'patch', '/api/thread/{id}')
    expect((res.body as { thread: ThreadBody }).thread).toMatchObject({
      id: thread.id,
      title: 'Renamed',
      topicId: 'sql'
    })
  })

  it('rejects an empty body, an unknown topic and an oversized body', async () => {
    const { cookie } = await signUp(client)
    const thread = await newThread(cookie)
    const path = `/api/thread/${thread.id}`
    const empty = await client.patch(path).set('Cookie', cookie).send({})
    expect(empty.status).toBe(400)
    expectContract(empty, 'patch', '/api/thread/{id}')
    const topic = await client.patch(path).set('Cookie', cookie).send({ topicId: 'cobol' })
    expect(topic.status).toBe(400)
    expect((topic.body as ErrorBody).error.details?.issues[0]?.path).toEqual(['topicId'])
    const big = await client
      .patch(path)
      .set('Cookie', cookie)
      .send({ title: 'x'.repeat(300_000) })
    expect(big.status).toBe(413)
    expectContract(big, 'patch', '/api/thread/{id}')
  })
})

describe('DELETE /api/thread/:id', () => {
  it('soft deletes: the row stays, every access then answers 404', async () => {
    const { cookie } = await signUp(client)
    const thread = await newThread(cookie)
    const path = `/api/thread/${thread.id}`
    const res = await client.delete(path).set('Cookie', cookie)
    expect(res.status).toBe(204)
    const row = await ctx.db
      .selectFrom('thread')
      .select('deleted_at')
      .where('id', '=', thread.id)
      .executeTakeFirstOrThrow()
    expect(row.deleted_at).not.toBeNull()
    for (const response of [
      await client.get(path).set('Cookie', cookie),
      await client.patch(path).set('Cookie', cookie).send({ title: 'x' }),
      await client.delete(path).set('Cookie', cookie),
      await client.post(`${path}/message`).set('Cookie', cookie).send({ content: 'hi' })
    ]) {
      expect(response.status).toBe(404)
      expect((response.body as ErrorBody).error.code).toBe('not_found')
    }
  })
})

// Cross-user ownership (AC03) is proven in ownership.test.ts.
