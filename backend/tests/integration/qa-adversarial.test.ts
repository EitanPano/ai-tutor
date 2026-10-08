import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp } from '../helper/client.js'
import { expectContract } from '../helper/contract.js'
import { parseSse } from '../helper/sse.js'
import { computeStreak, createProgressService } from '../../src/api/progress/service.js'

// QA adversarial pass for plan 001. Everything here goes through the HTTP API (or the progress
// service with an explicit clock), against the real test database and the fake provider.

const ctx = createTestApp()
const progressService = createProgressService({ db: ctx.db })
const client = createClient(ctx.app, ctx.config)

type Session = Awaited<ReturnType<typeof signUp>>
type ErrorBody = { error: { code: string; message: string; details?: unknown }; requestId: string }
type ThreadBody = { id: string; title: string }
type StepBody = { id: string }
type GuideBody = { id: string; steps: StepBody[] }
type QuizItemBody = { id: string }
type QuizBody = { id: string; items: QuizItemBody[] }

beforeEach(async () => {
  await truncateAll(ctx.db)
  ctx.tutor.reset()
})
afterAll(() => ctx.close())

async function newThread(session: Session, body: Record<string, unknown> = { topicId: 'react' }) {
  const res = await client.post('/api/thread').set('Cookie', session.cookie).send(body)
  expect(res.status).toBe(201)
  return (res.body as { thread: ThreadBody }).thread
}

function ask(session: Session, threadId: string, content: string) {
  return client
    .post(`/api/thread/${threadId}/message`)
    .set('Cookie', session.cookie)
    .send({ content })
}

/** A signed-in user with a thread that holds one complete answer. */
async function answered(question = 'Why does useEffect run twice?') {
  const session = await signUp(client)
  const thread = await newThread(session)
  expect((await ask(session, thread.id, question)).status).toBe(200)
  return { session, threadId: thread.id }
}

async function makeGuide(session: Session, threadId: string): Promise<GuideBody> {
  const res = await client.post(`/api/thread/${threadId}/guide`).set('Cookie', session.cookie)
  expect(res.status).toBe(201)
  return (res.body as { guide: GuideBody }).guide
}

async function makeQuiz(session: Session, threadId: string): Promise<QuizBody> {
  const res = await client.post('/api/quiz').set('Cookie', session.cookie).send({ threadId })
  expect(res.status).toBe(201)
  return (res.body as { quiz: QuizBody }).quiz
}

describe('session cookie abuse', () => {
  it('answers 401 unauthenticated for an expired session and clears the cookie', async () => {
    const session = await signUp(client)
    await sql`UPDATE session SET expires_at = now() - interval '1 minute'`.execute(ctx.db)
    const res = await client.get('/api/thread').set('Cookie', session.cookie)
    expect(res.status).toBe(401)
    expectContract(res, 'get', '/api/thread')
    expect((res.body as ErrorBody).error.code).toBe('unauthenticated')
    const cleared = (res.headers['set-cookie'] as string[] | undefined) ?? []
    expect(cleared.some((value) => value.startsWith('sid=;'))).toBe(true)
  })

  it('answers 401 for a session past its absolute cap even when expires_at is in the future', async () => {
    const session = await signUp(client)
    await sql`UPDATE session SET created_at = now() - interval '400 days',
      expires_at = now() + interval '10 days'`.execute(ctx.db)
    const res = await client.get('/api/thread').set('Cookie', session.cookie)
    expect(res.status).toBe(401)
  })

  it('answers 401 for a tampered cookie, a truncated cookie and an empty cookie', async () => {
    const session = await signUp(client)
    const value = session.cookie.slice('sid='.length)
    const flipped = `${value.slice(0, -1)}${value.endsWith('A') ? 'B' : 'A'}`
    for (const cookie of [
      `sid=${flipped}`,
      `sid=${value.slice(0, 5)}`,
      'sid=',
      'sid=%00',
      'sid=../..'
    ]) {
      const res = await client.get('/api/thread').set('Cookie', cookie)
      expect(res.status, cookie).toBe(401)
      expect((res.body as ErrorBody).error.code).toBe('unauthenticated')
    }
  })

  it('answers 401 for a very long cookie value without a 5xx', async () => {
    const res = await client.get('/api/thread').set('Cookie', `sid=${'x'.repeat(6000)}`)
    expect(res.status).toBe(401)
  })

  it('does not accept a session id passed through a header or the query string', async () => {
    const session = await signUp(client)
    const value = session.cookie.slice('sid='.length)
    const res = await client
      .get(`/api/thread?sid=${value}`)
      .set('Authorization', `Bearer ${value}`)
      .set('X-Session', value)
    expect(res.status).toBe(401)
  })
})

describe('cross-resource ids inside one account', () => {
  it('404s a PATCH of a step that belongs to another guide of the same user', async () => {
    const { session, threadId } = await answered()
    const other = await newThread(session)
    expect((await ask(session, other.id, 'What is a closure?')).status).toBe(200)
    const guideA = await makeGuide(session, threadId)
    const guideB = await makeGuide(session, other.id)
    const foreignStep = guideB.steps[0] as StepBody
    const res = await client
      .patch(`/api/guide/${guideA.id}/step/${foreignStep.id}`)
      .set('Cookie', session.cookie)
      .send({ done: true })
    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('not_found')
    // The foreign step is untouched.
    const row = await ctx.db
      .selectFrom('guide_step')
      .select('done_at')
      .where('id', '=', foreignStep.id)
      .executeTakeFirstOrThrow()
    expect(row.done_at).toBeNull()
  })

  it('422s an attempt that answers with item ids from another quiz, listing them as unknown', async () => {
    const { session, threadId } = await answered()
    const quizA = await makeQuiz(session, threadId)
    const quizB = await makeQuiz(session, threadId)
    const res = await client
      .post(`/api/quiz/${quizA.id}/attempt`)
      .set('Cookie', session.cookie)
      .send({ answers: quizB.items.map((item) => ({ itemId: item.id, choiceIndex: 0 })) })
    expect(res.status).toBe(422)
    expectContract(res, 'post', '/api/quiz/{id}/attempt')
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('attempt_incomplete')
    const details = body.error.details as { unknownItemIds: string[]; missingItemIds: string[] }
    expect([...details.unknownItemIds].sort()).toEqual(quizB.items.map((item) => item.id).sort())
    expect(details.missingItemIds).toHaveLength(5)
    const stored = await ctx.db.selectFrom('quiz_attempt').select('id').execute()
    expect(stored).toHaveLength(0)
  })

  it('400s an attempt with six answers (five items plus a duplicate and a foreign id)', async () => {
    const { session, threadId } = await answered()
    const quiz = await makeQuiz(session, threadId)
    const other = await makeQuiz(session, threadId)
    const answers = [
      ...quiz.items.slice(0, 4).map((item) => ({ itemId: item.id, choiceIndex: 1 })),
      { itemId: (quiz.items[0] as QuizItemBody).id, choiceIndex: 2 },
      { itemId: (other.items[0] as QuizItemBody).id, choiceIndex: 0 }
    ]
    const res = await client
      .post(`/api/quiz/${quiz.id}/attempt`)
      .set('Cookie', session.cookie)
      .send({ answers })
    // Six answers exceed the five-item cap: rejected by validation before grading.
    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('validation_failed')
  })

  it('404s reading an attempt through a different quiz id of the same user', async () => {
    const { session, threadId } = await answered()
    const quizA = await makeQuiz(session, threadId)
    const quizB = await makeQuiz(session, threadId)
    const submitted = await client
      .post(`/api/quiz/${quizA.id}/attempt`)
      .set('Cookie', session.cookie)
      .send({ answers: quizA.items.map((item) => ({ itemId: item.id, choiceIndex: 0 })) })
    expect(submitted.status).toBe(201)
    const attemptId = (submitted.body as { attempt: { id: string } }).attempt.id
    const res = await client
      .get(`/api/quiz/${quizB.id}/attempt/${attemptId}`)
      .set('Cookie', session.cookie)
    expect(res.status).toBe(404)
  })
})

describe('input limits', () => {
  it('accepts a 120-character thread title and rejects 121 with validation details', async () => {
    const session = await signUp(client)
    const ok = await client
      .post('/api/thread')
      .set('Cookie', session.cookie)
      .send({ title: 'a'.repeat(120) })
    expect(ok.status).toBe(201)
    const tooLong = await client
      .post('/api/thread')
      .set('Cookie', session.cookie)
      .send({ title: 'a'.repeat(121) })
    expect(tooLong.status).toBe(400)
    expectContract(tooLong, 'post', '/api/thread')
    expect((tooLong.body as ErrorBody).error.code).toBe('validation_failed')
    expect((tooLong.body as ErrorBody).error.details).toBeDefined()
    const patched = await client
      .patch(`/api/thread/${(ok.body as { thread: ThreadBody }).thread.id}`)
      .set('Cookie', session.cookie)
      .send({ title: 'b'.repeat(121) })
    expect(patched.status).toBe(400)
  })

  it('rejects a 1 MB thread title as 400 or 413, never a 5xx', async () => {
    const session = await signUp(client)
    const res = await client
      .post('/api/thread')
      .set('Cookie', session.cookie)
      .send({ title: 'a'.repeat(1_000_000) })
    expect([400, 413]).toContain(res.status)
    expect((res.body as ErrorBody).error.code).toBeTypeOf('string')
  })

  it('accepts an 80-character display name and rejects 81 at signup and on PATCH /api/user', async () => {
    const ok = await signUp(client, { displayName: 'n'.repeat(80) })
    expect(ok.user.displayName).toHaveLength(80)
    const bad = await client
      .post('/api/user')
      .send({ ...ok.body, email: 'other@example.com', displayName: 'n'.repeat(81) })
    expect(bad.status).toBe(400)
    const patch = await client
      .patch('/api/user')
      .set('Cookie', ok.cookie)
      .send({ displayName: 'n'.repeat(81) })
    expect(patch.status).toBe(400)
    expect((patch.body as ErrorBody).error.code).toBe('validation_failed')
  })

  it('rejects a whitespace-only thread title', async () => {
    const session = await signUp(client)
    const title = await client
      .post('/api/thread')
      .set('Cookie', session.cookie)
      .send({ title: '   ' })
    // A blank title would render as an empty row in the thread list.
    expect(title.status).toBe(400)
  })

  it('rejects a whitespace-only title on PATCH and trims padded titles', async () => {
    const session = await signUp(client)
    const thread = await newThread(session, { title: '  Padded title \t' })
    expect(thread.title).toBe('Padded title')
    const blank = await client
      .patch(`/api/thread/${thread.id}`)
      .set('Cookie', session.cookie)
      .send({ title: ' \n\t ' })
    expect(blank.status).toBe(400)
    expect((blank.body as ErrorBody).error.code).toBe('validation_failed')
    const trimmed = await client
      .patch(`/api/thread/${thread.id}`)
      .set('Cookie', session.cookie)
      .send({ title: '  Renamed  ' })
    expect((trimmed.body as { thread: ThreadBody }).thread.title).toBe('Renamed')
  })

  it('rejects a whitespace-only display name on PATCH and trims padded ones', async () => {
    const session = await signUp(client)
    const blank = await client
      .patch('/api/user')
      .set('Cookie', session.cookie)
      .send({ displayName: '   ' })
    expect(blank.status).toBe(400)
    const padded = await client
      .patch('/api/user')
      .set('Cookie', session.cookie)
      .send({ displayName: '  Ada  ' })
    expect((padded.body as { user: { displayName: string } }).user.displayName).toBe('Ada')
  })

  it('stores and returns Unicode and emoji text unchanged', async () => {
    const session = await signUp(client, { displayName: 'Zoë 山田 🧑‍💻' })
    expect(session.user.displayName).toBe('Zoë 山田 🧑‍💻')
    const thread = await newThread(session, { topicId: 'react', title: 'Hooks 🪝 and ñandú' })
    expect(thread.title).toBe('Hooks 🪝 and ñandú')
  })

  it('round-trips a 20,000-character question with code fences and emoji', async () => {
    const session = await signUp(client)
    const thread = await newThread(session)
    const block = '```ts\nconst x = 1 // 🚀 ünï\n```\n'
    const content = block.repeat(Math.floor(20_000 / block.length)).padEnd(20_000, '.')
    expect(content).toHaveLength(20_000)
    const res = await ask(session, thread.id, content)
    expect(res.status).toBe(200)
    const events = parseSse(res.text)
    expect(events.at(-1)?.event).toBe('message.complete')
    const detail = await client.get(`/api/thread/${thread.id}`).set('Cookie', session.cookie)
    const messages = (detail.body as { messages: { role: string; content: string }[] }).messages
    expect(messages[0]?.content).toBe(content)
  })

  it('rejects a 20,001-character question with validation details and saves nothing', async () => {
    const session = await signUp(client)
    const thread = await newThread(session)
    const res = await ask(session, thread.id, 'q'.repeat(20_001))
    expect(res.status).toBe(400)
    expectContract(res, 'post', '/api/thread/{id}/message')
    expect((res.body as ErrorBody).error.details).toBeDefined()
    const count = await ctx.db.selectFrom('message').select('id').execute()
    expect(count).toHaveLength(0)
  })

  it('does not 500 on a question that holds a lone surrogate', async () => {
    const session = await signUp(client)
    const thread = await newThread(session)
    const res = await client
      .post(`/api/thread/${thread.id}/message`)
      .set('Cookie', session.cookie)
      .set('Content-Type', 'application/json')
      .send('{"content":"broken \\ud800 surrogate"}')
    expect(res.status).toBeLessThan(500)
  })

  it('rejects a malformed JSON body and a non-object body with 400, not 500', async () => {
    const session = await signUp(client)
    const thread = await newThread(session)
    const broken = await client
      .post(`/api/thread/${thread.id}/message`)
      .set('Cookie', session.cookie)
      .set('Content-Type', 'application/json')
      .send('{"content":')
    expect(broken.status).toBe(400)
    const array = await client
      .post(`/api/thread/${thread.id}/message`)
      .set('Cookie', session.cookie)
      .send([1, 2, 3])
    expect(array.status).toBe(400)
    expect((array.body as ErrorBody).requestId).toBeTypeOf('string')
  })
})

describe('concurrency and empty-state conflicts', () => {
  it('answers 409 generation_in_progress to the second of two simultaneous asks', async () => {
    const session = await signUp(client)
    const a = await newThread(session)
    const b = await newThread(session)
    const [first, second] = await Promise.all([
      ask(session, a.id, 'first [fake:slow]'),
      ask(session, b.id, 'second [fake:slow]')
    ])
    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([200, 409])
    const loser = first.status === 409 ? first : second
    expect((loser.body as ErrorBody).error.code).toBe('generation_in_progress')
    // The lock is released once the winner finishes.
    const row = await ctx.db
      .selectFrom('app_user')
      .select('generation_started_at')
      .executeTakeFirstOrThrow()
    expect(row.generation_started_at).toBeNull()
  }, 40_000)

  it('answers 409 thread_empty for a guide and a quiz when the only answer failed', async () => {
    const session = await signUp(client)
    const thread = await newThread(session)
    const failed = await ask(session, thread.id, 'boom [fake:error]')
    expect(failed.status).toBe(200)
    expect(parseSse(failed.text).at(-1)?.event).toBe('error')
    const guide = await client.post(`/api/thread/${thread.id}/guide`).set('Cookie', session.cookie)
    expect(guide.status).toBe(409)
    expect((guide.body as ErrorBody).error.code).toBe('thread_empty')
    const quiz = await client
      .post('/api/quiz')
      .set('Cookie', session.cookie)
      .send({ threadId: thread.id })
    expect(quiz.status).toBe(409)
    expect((quiz.body as ErrorBody).error.code).toBe('thread_empty')
    const row = await ctx.db
      .selectFrom('app_user')
      .select('generation_started_at')
      .executeTakeFirstOrThrow()
    expect(row.generation_started_at).toBeNull()
  })

  it('answers 409 thread_empty for a brand-new thread with no messages', async () => {
    const session = await signUp(client)
    const thread = await newThread(session)
    const res = await client.post(`/api/thread/${thread.id}/guide`).set('Cookie', session.cookie)
    expect(res.status).toBe(409)
    expect((res.body as ErrorBody).error.code).toBe('thread_empty')
  })

  it('answers 409 thread_empty when the only answer was cut off at max_tokens (incomplete)', async () => {
    const session = await signUp(client)
    const thread = await newThread(session)
    expect((await ask(session, thread.id, 'long [fake:max_tokens]')).status).toBe(200)
    const res = await client.post(`/api/thread/${thread.id}/guide`).set('Cookie', session.cookie)
    expect(res.status).toBe(409)
  })
})

describe('forged pagination cursor', () => {
  async function threeThreads() {
    const session = await signUp(client)
    for (const title of ['one', 'two', 'three']) await newThread(session, { title })
    return session
  }

  const forge = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

  it('pages through every thread exactly once with a genuine cursor', async () => {
    const session = await threeThreads()
    const seen: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < 5; page += 1) {
      const res: { status: number; body: unknown } = await client
        .get(`/api/thread?limit=1${cursor ? `&cursor=${cursor}` : ''}`)
        .set('Cookie', session.cookie)
      expect(res.status).toBe(200)
      const body = res.body as { threads: ThreadBody[]; nextCursor: string | null }
      seen.push(...body.threads.map((thread) => thread.id))
      cursor = body.nextCursor
      if (!cursor) break
    }
    expect(new Set(seen).size).toBe(3)
    expect(seen).toHaveLength(3)
  })

  it('answers 400 validation_failed for garbage, wrong-shape and non-string cursors', async () => {
    const session = await threeThreads()
    const bad = [
      'not-base64!!',
      '%%%',
      Buffer.from('not json').toString('base64url'),
      forge({}),
      forge({ u: 1, i: 2 }),
      forge({ u: 'yesterday', i: 'x' }),
      forge({ u: '2026-10-07T00:00:00Z', i: '' }),
      forge([]),
      forge(null),
      forge('string')
    ]
    for (const cursor of bad) {
      const res = await client.get(`/api/thread?cursor=${cursor}`).set('Cookie', session.cookie)
      expect(res.status, cursor).toBe(400)
      expect((res.body as ErrorBody).error.code).toBe('validation_failed')
    }
  })

  it('treats an injection payload in the cursor id as data and returns 200', async () => {
    const session = await threeThreads()
    const cursor = forge({ u: '2099-01-01T00:00:00Z', i: "'; DROP TABLE thread; --" })
    const res = await client.get(`/api/thread?cursor=${cursor}`).set('Cookie', session.cookie)
    expect(res.status).toBe(200)
    const still = await ctx.db.selectFrom('thread').select('id').execute()
    expect(still).toHaveLength(3)
  })

  it('answers 400 for a cursor time that matches the shape but is not a real date', async () => {
    const session = await threeThreads()
    const cursor = forge({ u: '2026-13-45T25:61:61Z', i: 'x' })
    const res = await client.get(`/api/thread?cursor=${cursor}`).set('Cookie', session.cookie)
    expect(res.status).toBe(400)
  })

  it('answers 400 for a cursor id that holds a NUL character', async () => {
    const session = await threeThreads()
    const cursor = forge({ u: '2026-10-07T00:00:00.000000Z', i: 'a\u0000b' })
    const res = await client.get(`/api/thread?cursor=${cursor}`).set('Cookie', session.cookie)
    expect(res.status).toBe(400)
  })

  it('answers 400 for impossible calendar dates and oversized cursor ids', async () => {
    const session = await threeThreads()
    const bad = [
      { u: '2026-02-30T00:00:00Z', i: 'x' },
      { u: '2026-10-07T24:00:00Z', i: 'x' },
      { u: '2026-10-07T00:00:00Z', i: 'x'.repeat(65) }
    ]
    for (const value of bad) {
      const res = await client
        .get(`/api/thread?cursor=${forge(value)}`)
        .set('Cookie', session.cookie)
      expect(res.status, JSON.stringify(value)).toBe(400)
      expect((res.body as ErrorBody).error.code).toBe('validation_failed')
    }
  })

  it('never lets another user cursor reveal their threads', async () => {
    const owner = await threeThreads()
    const stranger = await signUp(client)
    const page = await client.get('/api/thread?limit=1').set('Cookie', owner.cookie)
    const cursor = (page.body as { nextCursor: string }).nextCursor
    const res = await client.get(`/api/thread?cursor=${cursor}`).set('Cookie', stranger.cookie)
    expect(res.status).toBe(200)
    expect((res.body as { threads: unknown[] }).threads).toEqual([])
  })
})

describe('progress edge cases (Task 13 review carry-overs)', () => {
  const ZONE = 'America/New_York'
  // New York is UTC-4 in October 2026, so these offsets are exact.
  const at = (day: number, time: string, month = 10) =>
    new Date(
      `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${time}:00-04:00`
    )

  async function questionAt(userId: string, threadId: string, createdAt: Date) {
    await ctx.db
      .insertInto('message')
      .values({
        thread_id: threadId,
        user_id: userId,
        role: 'user',
        content: 'seeded',
        status: 'complete',
        created_at: createdAt
      })
      .execute()
  }

  async function userWithThread() {
    const session = await signUp(client, { timeZone: ZONE })
    const thread = await ctx.db
      .insertInto('thread')
      .values({ user_id: session.user.id, topic_id: 'react', title: 'seeded' })
      .returning('id')
      .executeTakeFirstOrThrow()
    return { session, threadId: thread.id }
  }

  it('uses the user local date, not UTC, for activeToday and current', async () => {
    const { session, threadId } = await userWithThread()
    // now = 2026-10-07T02:00Z = Oct 6 22:00 in New York: the UTC date (Oct 7) is already tomorrow.
    const now = new Date('2026-10-07T02:00:00Z')
    // 20:00 local on Oct 6 is 00:00Z on Oct 7: its UTC date is Oct 7, its local date is Oct 6.
    await questionAt(session.user.id, threadId, at(6, '20:00'))
    await questionAt(session.user.id, threadId, at(5, '09:00'))
    await questionAt(session.user.id, threadId, at(4, '09:00'))
    const progress = await progressService.get({ userId: session.user.id }, { now })
    expect(progress.streak).toEqual({ current: 3, longest: 3, activeToday: true })
  })

  it('does not count the UTC next day as active for a late-evening local user', async () => {
    const { session, threadId } = await userWithThread()
    // Local 23:30 on Oct 6 is 03:30Z on Oct 7. Viewed at local 23:45 on Oct 6.
    await questionAt(session.user.id, threadId, at(6, '23:30'))
    const now = at(6, '23:45')
    const progress = await progressService.get({ userId: session.user.id }, { now })
    expect(progress.streak).toEqual({ current: 1, longest: 1, activeToday: true })
  })

  it('reports longest 4 and current 2 for an older 4-day run and a current 2-day run', async () => {
    const { session, threadId } = await userWithThread()
    const now = new Date('2026-10-07T15:00:00Z') // 11:00 on Oct 7 in New York
    for (const [month, day] of [
      [9, 30],
      [10, 1],
      [10, 2],
      [10, 3],
      [10, 6],
      [10, 7]
    ] as const) {
      await questionAt(session.user.id, threadId, at(day, '12:00', month))
    }
    const progress = await progressService.get({ userId: session.user.id }, { now })
    expect(progress.streak).toEqual({ current: 2, longest: 4, activeToday: true })
  })

  it('answers current 1 and activeToday false when only yesterday is active', async () => {
    const { session, threadId } = await userWithThread()
    await questionAt(session.user.id, threadId, at(6, '12:00'))
    const progress = await progressService.get(
      { userId: session.user.id },
      { now: new Date('2026-10-07T15:00:00Z') }
    )
    expect(progress.streak).toEqual({ current: 1, longest: 1, activeToday: false })
  })

  it('computeStreak survives an empty list and duplicate days', () => {
    expect(computeStreak([], '2026-10-07')).toEqual({ current: 0, longest: 0, activeToday: false })
    expect(computeStreak(['2026-10-07', '2026-10-07'], '2026-10-07')).toEqual({
      current: 1,
      longest: 1,
      activeToday: true
    })
  })

  it('answers 500 internal_error, without leaking details, for an attempt whose answer is []', async () => {
    const { session, threadId } = await answered()
    const quiz = await makeQuiz(session, threadId)
    const submitted = await client
      .post(`/api/quiz/${quiz.id}/attempt`)
      .set('Cookie', session.cookie)
      .send({ answers: quiz.items.map((item) => ({ itemId: item.id, choiceIndex: 0 })) })
    expect(submitted.status).toBe(201)
    const attemptId = (submitted.body as { attempt: { id: string } }).attempt.id
    await sql`UPDATE quiz_attempt SET answer = '[]'::jsonb`.execute(ctx.db)
    const res = await client
      .get(`/api/quiz/${quiz.id}/attempt/${attemptId}`)
      .set('Cookie', session.cookie)
    expect(res.status).toBe(500)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('internal_error')
    expect(body.requestId).toBeTypeOf('string')
    expect(res.text).not.toMatch(/no answer for item|stack|at .*\.ts/i)
  })
})
