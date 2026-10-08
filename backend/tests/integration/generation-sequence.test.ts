import { sql } from 'kysely'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp } from '../helper/client.js'

const ctx = createTestApp()
const client = createClient(ctx.app, ctx.config)

type ErrorBody = { error: { code: string } }
type Session = Awaited<ReturnType<typeof signUp>>

beforeEach(async () => {
  await truncateAll(ctx.db)
  ctx.tutor.reset()
})
afterAll(() => ctx.close())

async function lockOf(userId: string) {
  const row = await ctx.db
    .selectFrom('app_user')
    .select('generation_started_at')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow()
  return row.generation_started_at
}

async function answeredThread() {
  const session = await signUp(client)
  const thread = (
    await client.post('/api/thread').set('Cookie', session.cookie).send({ topicId: 'react' })
  ).body as { thread: { id: string } }
  const asked = await client
    .post(`/api/thread/${thread.thread.id}/message`)
    .set('Cookie', session.cookie)
    .send({ content: 'Why does useEffect run twice?' })
  expect(asked.status).toBe(200)
  return { session, threadId: thread.thread.id }
}

async function exhaustBudget(session: Session) {
  await sql`
    INSERT INTO ai_call (user_id, kind, model, input_token, output_token, cache_read_token,
      stop_reason, latency_ms, created_at)
    SELECT id, 'explain', 'fake', ${ctx.config.aiDailyTokenBudget}, 0, 0, 'end_turn', 1,
      (date_trunc('day', now() AT TIME ZONE time_zone) + interval '12 hours') AT TIME ZONE time_zone
    FROM app_user WHERE id = ${session.user.id}`.execute(ctx.db)
}

const guideOf = (session: Session, threadId: string) =>
  client.post(`/api/thread/${threadId}/guide`).set('Cookie', session.cookie)
const quizOf = (session: Session, body: object) =>
  client.post('/api/quiz').set('Cookie', session.cookie).send(body)

describe('guide and quiz share one error order', () => {
  it('answers 429 for both when the user is over budget on a valid thread', async () => {
    const { session, threadId } = await answeredThread()
    await exhaustBudget(session)
    const guide = await guideOf(session, threadId)
    const quiz = await quizOf(session, { threadId, difficulty: 'easy' })
    expect(guide.status).toBe(429)
    expect(quiz.status).toBe(429)
    expect((guide.body as ErrorBody).error.code).toBe('ai_budget_exceeded')
    expect((quiz.body as ErrorBody).error.code).toBe('ai_budget_exceeded')
    expect(await lockOf(session.user.id)).toBeNull()
  })

  it('answers 404 before any budget check for an unknown thread', async () => {
    const { session } = await answeredThread()
    await exhaustBudget(session)
    const unknown = '00000000-0000-0000-0000-000000000000'
    const guide = await guideOf(session, unknown)
    const quizThread = await quizOf(session, { threadId: unknown, difficulty: 'easy' })
    for (const res of [guide, quizThread]) {
      expect(res.status).toBe(404)
    }
  })

  it('answers 409 before any budget check for a thread with no answer', async () => {
    const session = await signUp(client)
    const thread = (
      await client.post('/api/thread').set('Cookie', session.cookie).send({ topicId: 'react' })
    ).body as { thread: { id: string } }
    await exhaustBudget(session)
    const guide = await guideOf(session, thread.thread.id)
    const quiz = await quizOf(session, { threadId: thread.thread.id, difficulty: 'easy' })
    expect(guide.status).toBe(409)
    expect(quiz.status).toBe(409)
  })
})

describe('AiApi.withGenerationLock', () => {
  it('holds the lock while fn runs and releases it after', async () => {
    const { user } = await signUp(client)
    const auth = { userId: user.id }
    const result = await ctx.services.ai.withGenerationLock(auth, async () => {
      expect(await lockOf(user.id)).not.toBeNull()
      await expect(ctx.services.ai.acquireLock(auth)).rejects.toMatchObject({ status: 409 })
      return 'done'
    })
    expect(result).toBe('done')
    expect(await lockOf(user.id)).toBeNull()
  })

  it('releases the lock when fn throws, so the next generation is not 409', async () => {
    const { user } = await signUp(client)
    const auth = { userId: user.id }
    await expect(
      ctx.services.ai.withGenerationLock(auth, () => Promise.reject(new Error('boom')))
    ).rejects.toThrow('boom')
    expect(await lockOf(user.id)).toBeNull()
    await expect(ctx.services.ai.withGenerationLock(auth, () => Promise.resolve(1))).resolves.toBe(
      1
    )
  })

  it('checks the budget before the lock and never runs fn when over budget', async () => {
    const session = await signUp(client)
    const auth = { userId: session.user.id }
    await exhaustBudget(session)
    const held = await ctx.services.ai.acquireLock(auth)
    let ran = false
    await expect(
      ctx.services.ai.withGenerationLock(auth, () => {
        ran = true
        return Promise.resolve()
      })
    ).rejects.toMatchObject({ status: 429, code: 'ai_budget_exceeded' })
    expect(ran).toBe(false)
    await ctx.services.ai.releaseLock(auth, held)
  })

  it('answers 409 while another generation holds the lock', async () => {
    const { user } = await signUp(client)
    const auth = { userId: user.id }
    const held = await ctx.services.ai.acquireLock(auth)
    await expect(
      ctx.services.ai.withGenerationLock(auth, () => Promise.resolve(1))
    ).rejects.toMatchObject({
      status: 409,
      code: 'generation_in_progress'
    })
    expect(await lockOf(user.id)).not.toBeNull()
    await ctx.services.ai.releaseLock(auth, held)
  })
})

describe('AiApi.recordCall', () => {
  it('maps the domain shape to the ai_call columns, clamping the latency', async () => {
    const { user } = await signUp(client)
    const auth = { userId: user.id }
    await ctx.services.ai.recordCall(auth, {
      kind: 'guide',
      model: 'm-1',
      usage: { inputTokens: 11, outputTokens: 22, cacheReadTokens: 33, cacheCreationTokens: 44 },
      stopReason: 'max_tokens',
      refusalCategory: null,
      latencyMs: 12.6
    })
    await ctx.services.ai.recordCall(auth, {
      kind: 'explain',
      model: 'm-2',
      usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 },
      stopReason: 'refusal',
      refusalCategory: 'cyber',
      latencyMs: -5
    })
    const rows = await ctx.db.selectFrom('ai_call').selectAll().orderBy('model').execute()
    expect(rows).toMatchObject([
      {
        user_id: user.id,
        kind: 'guide',
        model: 'm-1',
        input_token: 11,
        output_token: 22,
        cache_read_token: 33,
        cache_creation_token: 44,
        stop_reason: 'max_tokens',
        refusal_category: null,
        latency_ms: 13
      },
      {
        kind: 'explain',
        model: 'm-2',
        input_token: 1,
        output_token: 2,
        cache_read_token: 3,
        cache_creation_token: 4,
        stop_reason: 'refusal',
        refusal_category: 'cyber',
        latency_ms: 0
      }
    ])
  })
})
