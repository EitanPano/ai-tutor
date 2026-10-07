import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createProgressService,
  computeStreak,
  type ProgressDto
} from '../../src/feature/progress/progress.service.js'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp } from '../helper/client.js'
import { expectContract, expectSchema } from '../helper/contract.js'

const ctx = createTestApp()
const progressService = createProgressService({ db: ctx.db })
const client = createClient(ctx.app, ctx.config)

type Session = Awaited<ReturnType<typeof signUp>>
type ErrorBody = { error: { code: string }; requestId: string }

beforeEach(async () => {
  await truncateAll(ctx.db)
})
afterAll(() => ctx.close())

// New York is UTC-4 (EDT) for all of October 2026, so fixed offsets are exact.
const ZONE = 'America/New_York'
const NOW = new Date('2026-10-07T15:00:00Z') // 11:00 on Oct 7 in New York

/** A local New York wall-clock time, e.g. `at(6, '23:30')` = Oct 6 23:30 EDT = Oct 7 03:30Z. */
const at = (day: number, time: string) =>
  new Date(`2026-10-${String(day).padStart(2, '0')}T${time}:00-04:00`)

async function newUser(timeZone = ZONE): Promise<Session> {
  return signUp(client, { timeZone })
}

async function addThread(userId: string, topicId: string, title: string, deleted = false) {
  return ctx.db
    .insertInto('thread')
    .values({
      user_id: userId,
      topic_id: topicId,
      title,
      deleted_at: deleted ? new Date() : null
    })
    .returning(['id', 'topic_id'])
    .executeTakeFirstOrThrow()
}

async function addQuestion(
  userId: string,
  threadId: string,
  createdAt: Date,
  status: 'complete' | 'failed' = 'complete',
  role: 'user' | 'assistant' = 'user'
) {
  await ctx.db
    .insertInto('message')
    .values({
      thread_id: threadId,
      user_id: userId,
      role,
      content: 'seeded',
      status,
      created_at: createdAt
    })
    .execute()
}

/** A guide with one step per entry; an entry is the `done_at` of that step, or null. */
async function addGuide(userId: string, threadId: string, topicId: string, steps: (Date | null)[]) {
  const guide = await ctx.db
    .insertInto('guide')
    .values({ user_id: userId, thread_id: threadId, topic_id: topicId, title: `Guide ${topicId}` })
    .returning('id')
    .executeTakeFirstOrThrow()
  if (steps.length === 0) return guide.id
  await ctx.db
    .insertInto('guide_step')
    .values(
      steps.map((doneAt, index) => ({
        guide_id: guide.id,
        user_id: userId,
        position: index + 1,
        title: `Step ${topicId} ${index + 1}`,
        body: 'body',
        hint: 'hint',
        done_at: doneAt
      }))
    )
    .execute()
  return guide.id
}

async function addQuiz(
  userId: string,
  topicId: string,
  difficulty: 'easy' | 'medium' | 'hard',
  attempts: { score: number; at: Date }[],
  threadId: string | null = null
) {
  const quiz = await ctx.db
    .insertInto('quiz')
    .values({ user_id: userId, thread_id: threadId, topic_id: topicId, difficulty })
    .returning('id')
    .executeTakeFirstOrThrow()
  for (const attempt of attempts) {
    await ctx.db
      .insertInto('quiz_attempt')
      .values({
        quiz_id: quiz.id,
        user_id: userId,
        answer: '[]',
        score: attempt.score,
        total: 5,
        submitted_at: attempt.at
      })
      .execute()
  }
  return quiz.id
}

/** The AC08 fixture: three consecutive local days ending today, a gap, then a two-day run. */
async function seedFixture(userId: string) {
  const react = await addThread(userId, 'react', 'React effects')
  const sql = await addThread(userId, 'sql', 'SQL joins')
  // React questions on Oct 7, Oct 6 (23:30 local = Oct 7 03:30Z), Oct 5, Oct 2, Oct 1.
  for (const [day, time] of [
    [7, '09:00'],
    [6, '23:30'],
    [5, '12:00'],
    [2, '12:00'],
    [1, '12:00']
  ] as const) {
    await addQuestion(userId, react.id, at(day, time))
  }
  // SQL questions, and noise that must not count or make a day active.
  await addQuestion(userId, sql.id, at(5, '20:00'))
  await addQuestion(userId, sql.id, at(1, '08:00'))
  await addQuestion(userId, sql.id, at(4, '12:00'), 'failed')
  await addQuestion(userId, sql.id, at(3, '12:00'), 'complete', 'assistant')
  // One finished guide (3 of 3) and one with 1 of 4 steps done.
  const finished = await addGuide(userId, react.id, 'react', [
    at(6, '12:00'),
    at(7, '10:00'),
    at(7, '10:30')
  ])
  const partial = await addGuide(userId, sql.id, 'sql', [at(5, '18:00'), null, null, null])
  // Two attempts on one quiz (2/5 then 4/5), one on another (3/5): best 80, mean of 80 and 60.
  const first = await addQuiz(userId, 'react', 'easy', [
    { score: 2, at: at(2, '14:00') },
    { score: 4, at: at(5, '14:00') }
  ])
  await addQuiz(userId, 'react', 'medium', [{ score: 3, at: at(1, '14:00') }])
  return { react, sql, finished, partial, quiz: first }
}

describe('GET /api/progress (AC08)', () => {
  it('computes per-topic counts, scores, totals and the streak from the seeded fixture', async () => {
    const { user } = await newUser()
    const seeded = await seedFixture(user.id)

    const progress = await progressService.get({ userId: user.id }, { now: NOW })
    expectSchema(progress, 'ProgressResponse')

    expect(progress.topics.map((topic) => topic.topicId)).toEqual([
      'react',
      'typescript',
      'javascript',
      'node',
      'css',
      'sql',
      'git',
      'docker',
      'testing',
      'python',
      'algorithms',
      'other'
    ])
    const [react, , , , , sqlTopic] = progress.topics
    expect(react).toEqual({
      topicId: 'react',
      topicName: 'React',
      questions: 5,
      guidesCompleted: 1,
      stepsDone: 3,
      attempts: 3,
      bestScorePercent: 80,
      averageScorePercent: 70,
      lastActivityAt: at(7, '10:30').toISOString()
    })
    expect(sqlTopic).toEqual({
      topicId: 'sql',
      topicName: 'SQL',
      questions: 2,
      guidesCompleted: 0,
      stepsDone: 1,
      attempts: 0,
      bestScorePercent: null,
      averageScorePercent: null,
      lastActivityAt: at(5, '20:00').toISOString()
    })
    for (const topic of progress.topics.filter(
      (t) => t.topicId !== 'react' && t.topicId !== 'sql'
    )) {
      expect(topic).toMatchObject({
        questions: 0,
        guidesCompleted: 0,
        stepsDone: 0,
        attempts: 0,
        bestScorePercent: null,
        averageScorePercent: null,
        lastActivityAt: null
      })
    }
    expect(progress.totals).toEqual({ questions: 7, guidesCompleted: 1, stepsDone: 4, attempts: 3 })
    // Oct 5, 6 (23:30 local, already Oct 7 in UTC) and 7 are active; Oct 3-4 are not.
    expect(progress.streak).toEqual({ current: 3, longest: 3, activeToday: true })

    // 14 events exist; the 10 newest come back, newest first, with the right ids per kind.
    expect(progress.recent).toHaveLength(10)
    const times = progress.recent.map((event) => event.at)
    expect(times).toEqual([...times].sort().reverse())
    expect(progress.recent[0]).toEqual({
      kind: 'step',
      at: at(7, '10:30').toISOString(),
      topicId: 'react',
      title: 'Step react 3',
      threadId: seeded.react.id,
      guideId: seeded.finished,
      quizId: null
    })
    expect(progress.recent[2]).toEqual({
      kind: 'question',
      at: at(7, '09:00').toISOString(),
      topicId: 'react',
      title: 'React effects',
      threadId: seeded.react.id,
      guideId: null,
      quizId: null
    })
    expect(progress.recent[7]).toEqual({
      kind: 'attempt',
      at: at(5, '14:00').toISOString(),
      topicId: 'react',
      title: 'Scored 4 of 5 on an easy React quiz',
      threadId: null,
      guideId: null,
      quizId: seeded.quiz
    })
    expect(progress.recent[9]?.at).toBe(at(2, '14:00').toISOString())
  })

  it('uses the user time zone, not UTC, for the day boundary', async () => {
    const { user } = await newUser()
    const thread = await addThread(user.id, 'react', 'React effects')
    // 23:30 on Oct 6 in New York is 03:30Z on Oct 7: UTC would merge it into today.
    await addQuestion(user.id, thread.id, at(6, '23:30'))
    const progress = await progressService.get({ userId: user.id }, { now: NOW })
    // In UTC that question would fall on today (Oct 7) and activeToday would be true.
    expect(progress.streak).toEqual({ current: 1, longest: 1, activeToday: false })
  })

  it('counts through yesterday when today is not active yet', async () => {
    const { user } = await newUser()
    const thread = await addThread(user.id, 'react', 'React effects')
    await addQuestion(user.id, thread.id, at(6, '09:00'))
    await addQuestion(user.id, thread.id, at(5, '09:00'))
    await addQuestion(user.id, thread.id, at(4, '09:00'))
    const progress = await progressService.get({ userId: user.id }, { now: NOW })
    expect(progress.streak).toEqual({ current: 3, longest: 3, activeToday: false })
  })

  it('resets the current streak to 0 once a whole day was missed', async () => {
    const { user } = await newUser()
    const thread = await addThread(user.id, 'react', 'React effects')
    await addQuestion(user.id, thread.id, at(5, '09:00'))
    await addQuestion(user.id, thread.id, at(4, '09:00'))
    const progress = await progressService.get({ userId: user.id }, { now: NOW })
    expect(progress.streak).toEqual({ current: 0, longest: 2, activeToday: false })
  })

  it('returns zeros, nulls, every topic and an empty recent list for a new user', async () => {
    const { cookie } = await newUser()
    const res = await client.get('/api/progress').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expectContract(res, 'get', '/api/progress')
    const body = res.body as ProgressDto
    expect(body.totals).toEqual({ questions: 0, guidesCompleted: 0, stepsDone: 0, attempts: 0 })
    expect(body.streak).toEqual({ current: 0, longest: 0, activeToday: false })
    expect(body.recent).toEqual([])
    expect(body.topics).toHaveLength(12)
    expect(body.topics[0]).toEqual({
      topicId: 'react',
      topicName: 'React',
      questions: 0,
      guidesCompleted: 0,
      stepsDone: 0,
      attempts: 0,
      bestScorePercent: null,
      averageScorePercent: null,
      lastActivityAt: null
    })
  })

  it('serves a contract-valid response over HTTP for a user with data', async () => {
    const { user, cookie } = await newUser()
    await seedFixture(user.id)
    const res = await client.get('/api/progress').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expectContract(res, 'get', '/api/progress')
    expect((res.body as { totals: { questions: number } }).totals.questions).toBe(7)
  })

  it('answers 401 without a session', async () => {
    const res = await client.get('/api/progress')
    expect(res.status).toBe(401)
    expectContract(res, 'get', '/api/progress')
    expect((res.body as ErrorBody).error.code).toBe('unauthenticated')
  })

  it('does not count failed questions or another user data', async () => {
    const mine = await newUser()
    const other = await newUser()
    const thread = await addThread(mine.user.id, 'react', 'Mine')
    await addQuestion(mine.user.id, thread.id, at(7, '09:00'), 'failed')
    await seedFixture(other.user.id)

    const progress = await progressService.get({ userId: mine.user.id }, { now: NOW })
    expect(progress.totals).toEqual({ questions: 0, guidesCompleted: 0, stepsDone: 0, attempts: 0 })
    expect(progress.streak).toEqual({ current: 0, longest: 0, activeToday: false })
    expect(progress.recent).toEqual([])
  })

  it('excludes soft-deleted threads and what derives from them, but keeps topic-only quizzes', async () => {
    const { user } = await newUser()
    const gone = await addThread(user.id, 'react', 'Deleted', true)
    await addQuestion(user.id, gone.id, at(7, '09:00'))
    await addGuide(user.id, gone.id, 'react', [at(7, '10:00')])
    await addQuiz(user.id, 'react', 'hard', [{ score: 5, at: at(7, '11:00') }], gone.id)
    await addQuiz(user.id, 'react', 'hard', [{ score: 1, at: at(6, '11:00') }])

    const progress = await progressService.get({ userId: user.id }, { now: NOW })
    expect(progress.totals).toEqual({ questions: 0, guidesCompleted: 0, stepsDone: 0, attempts: 1 })
    expect(progress.topics[0]).toMatchObject({
      attempts: 1,
      bestScorePercent: 20,
      averageScorePercent: 20,
      lastActivityAt: at(6, '11:00').toISOString()
    })
    expect(progress.streak).toEqual({ current: 1, longest: 1, activeToday: false })
    expect(progress.recent).toHaveLength(1)
    expect(progress.recent[0]).toMatchObject({
      kind: 'attempt',
      title: 'Scored 1 of 5 on a hard React quiz'
    })
  })

  it('does not call a guide with no steps completed', async () => {
    const { user } = await newUser()
    const thread = await addThread(user.id, 'react', 'React effects')
    await addGuide(user.id, thread.id, 'react', [])
    const progress = await progressService.get({ userId: user.id }, { now: NOW })
    expect(progress.totals.guidesCompleted).toBe(0)
  })
})

describe('computeStreak', () => {
  it('handles runs across month boundaries and ignores duplicates', () => {
    expect(
      computeStreak(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-01'], '2026-10-02')
    ).toEqual({
      current: 3,
      longest: 3,
      activeToday: false
    })
  })

  it('is all zeros without activity', () => {
    expect(computeStreak([], '2026-10-07')).toEqual({ current: 0, longest: 0, activeToday: false })
  })
})
