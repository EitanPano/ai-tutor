import { sql } from 'kysely'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp } from '../helper/client.js'
import { expectContract, expectSchema } from '../helper/contract.js'
import { createGuideService } from '../../src/api/guide/service.js'

const ctx = createTestApp()
const client = createClient(ctx.app, ctx.config)
const guideService = createGuideService({
  db: ctx.db,
  tutor: ctx.tutor,
  topic: ctx.services.topic,
  ai: ctx.services.ai,
  thread: ctx.services.thread
})

type StepBody = {
  id: string
  position: number
  title: string
  hintRevealedAt: string | null
  doneAt: string | null
}
type GuideBody = { id: string; threadId: string; topicId: string; title: string; steps: StepBody[] }
type ErrorBody = { error: { code: string; message: string }; requestId: string }
type Session = Awaited<ReturnType<typeof signUp>>

beforeEach(async () => {
  await truncateAll(ctx.db)
  ctx.tutor.reset()
})
afterAll(() => ctx.close())

/** A thread with one complete question and answer. The question may carry a fake marker. */
async function setup(question = 'Why does useEffect run twice?') {
  const session = await signUp(client)
  const thread = (
    await client.post('/api/thread').set('Cookie', session.cookie).send({ topicId: 'react' })
  ).body as { thread: { id: string } }
  const asked = await client
    .post(`/api/thread/${thread.thread.id}/message`)
    .set('Cookie', session.cookie)
    .send({ content: question })
  expect(asked.status).toBe(200)
  return { session, threadId: thread.thread.id }
}

function generate(session: Session, threadId: string) {
  return client.post(`/api/thread/${threadId}/guide`).set('Cookie', session.cookie)
}

async function createdGuide(session: Session, threadId: string): Promise<GuideBody> {
  const res = await generate(session, threadId)
  expect(res.status).toBe(201)
  return (res.body as { guide: GuideBody }).guide
}

async function guideCalls(userId: string) {
  return ctx.db
    .selectFrom('ai_call')
    .selectAll()
    .where('user_id', '=', userId)
    .where('kind', '=', 'guide')
    .execute()
}

async function lockOf(userId: string): Promise<Date | null> {
  const row = await ctx.db
    .selectFrom('app_user')
    .select('generation_started_at')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow()
  return row.generation_started_at
}

async function guideCount(userId: string): Promise<number> {
  const rows = await ctx.db.selectFrom('guide').select('id').where('user_id', '=', userId).execute()
  return rows.length
}

describe('guide generation and reading (AC06)', () => {
  it('generates a guide with 3-8 ordered steps and returns it by id', async () => {
    const { session, threadId } = await setup()
    const res = await generate(session, threadId)
    expect(res.status).toBe(201)
    expectContract(res, 'post', '/api/thread/{id}/guide')
    const guide = (res.body as { guide: GuideBody }).guide
    expect(guide).toMatchObject({ threadId, topicId: 'react' })
    expect(guide.steps.length).toBeGreaterThanOrEqual(3)
    expect(guide.steps.length).toBeLessThanOrEqual(8)
    expect(guide.steps.map((step) => step.position)).toEqual(
      guide.steps.map((_step, index) => index + 1)
    )
    expect(guide.steps.every((step) => step.hintRevealedAt === null && step.doneAt === null)).toBe(
      true
    )
    expect(ctx.tutor.guideCalls).toHaveLength(1)
    expect(ctx.tutor.guideCalls[0]?.topicName).toBe('React')
    expect(await lockOf(session.user.id)).toBeNull()

    const read = await client.get(`/api/guide/${guide.id}`).set('Cookie', session.cookie)
    expect(read.status).toBe(200)
    expectContract(read, 'get', '/api/guide/{id}')
    expect((read.body as { guide: GuideBody }).guide).toEqual(guide)
  })

  it('records one guide ai_call for a successful generation', async () => {
    const { session, threadId } = await setup()
    await createdGuide(session, threadId)
    const calls = await guideCalls(session.user.id)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ model: 'fake', stop_reason: 'end_turn' })
  })

  it('persists isHintRevealed and isDone, and clears isDone again', async () => {
    const { session, threadId } = await setup()
    const guide = await createdGuide(session, threadId)
    const step = guide.steps[0] as StepBody
    const path = `/api/guide/${guide.id}/step/${step.id}`

    const hint = await client
      .patch(path)
      .set('Cookie', session.cookie)
      .send({ isHintRevealed: true })
    expect(hint.status).toBe(200)
    expectContract(hint, 'patch', '/api/guide/{id}/step/{stepId}')
    const hintAt = (hint.body as { step: StepBody }).step.hintRevealedAt
    expect(hintAt).not.toBeNull()

    const done = await client.patch(path).set('Cookie', session.cookie).send({ isDone: true })
    expect(done.status).toBe(200)
    expectContract(done, 'patch', '/api/guide/{id}/step/{stepId}')
    const doneAt = (done.body as { step: StepBody }).step.doneAt
    expect(doneAt).not.toBeNull()

    // Both are idempotent: a second call keeps the first timestamp.
    const again = await client
      .patch(path)
      .set('Cookie', session.cookie)
      .send({ isDone: true, isHintRevealed: true })
    expect((again.body as { step: StepBody }).step).toMatchObject({
      doneAt,
      hintRevealedAt: hintAt
    })

    let reread = await client.get(`/api/guide/${guide.id}`).set('Cookie', session.cookie)
    expectContract(reread, 'get', '/api/guide/{id}')
    expect((reread.body as { guide: GuideBody }).guide.steps[0]).toMatchObject({
      doneAt,
      hintRevealedAt: hintAt
    })

    const undone = await client.patch(path).set('Cookie', session.cookie).send({ isDone: false })
    expect((undone.body as { step: StepBody }).step).toMatchObject({
      doneAt: null,
      hintRevealedAt: hintAt
    })
    reread = await client.get(`/api/guide/${guide.id}`).set('Cookie', session.cookie)
    expect((reread.body as { guide: GuideBody }).guide.steps[0]).toMatchObject({
      doneAt: null,
      hintRevealedAt: hintAt
    })
  })

  it('lists the guide in the thread detail with stepCount and doneCount, newest first', async () => {
    const { session, threadId } = await setup()
    const first = await createdGuide(session, threadId)
    const second = await createdGuide(session, threadId)
    await client
      .patch(`/api/guide/${first.id}/step/${first.steps[0]?.id}`)
      .set('Cookie', session.cookie)
      .send({ isDone: true })
    await client
      .patch(`/api/guide/${first.id}/step/${first.steps[1]?.id}`)
      .set('Cookie', session.cookie)
      .send({ isDone: true })

    const res = await client.get(`/api/thread/${threadId}`).set('Cookie', session.cookie)
    expectContract(res, 'get', '/api/thread/{id}')
    const { guides } = res.body as {
      guides: { id: string; title: string; stepCount: number; doneCount: number }[]
    }
    expectSchema(guides[0], 'GuideSummary')
    expect(guides.map((guide) => guide.id)).toEqual([second.id, first.id])
    expect(guides[0]).toMatchObject({ stepCount: first.steps.length, doneCount: 0 })
    expect(guides[1]).toMatchObject({ stepCount: first.steps.length, doneCount: 2 })
  })
})

describe('invalid output, refusal and provider errors (AC10)', () => {
  it('answers 502 ai_invalid_output after exactly two calls when the output stays invalid', async () => {
    const { session, threadId } = await setup('question [fake:guide-invalid]')
    const res = await generate(session, threadId)
    expect(res.status).toBe(502)
    expectContract(res, 'post', '/api/thread/{id}/guide')
    expect((res.body as ErrorBody).error.code).toBe('ai_invalid_output')
    expect(await guideCalls(session.user.id)).toHaveLength(2)
    expect(ctx.tutor.guideCalls).toHaveLength(2)
    expect(await guideCount(session.user.id)).toBe(0)
    expect(await lockOf(session.user.id)).toBeNull()
  })

  it('succeeds after one retry when the first output is invalid', async () => {
    const { session, threadId } = await setup('question [fake:guide-invalid-once]')
    const res = await generate(session, threadId)
    expect(res.status).toBe(201)
    expectContract(res, 'post', '/api/thread/{id}/guide')
    expect(await guideCalls(session.user.id)).toHaveLength(2)
    expect(await guideCount(session.user.id)).toBe(1)
    expect(await lockOf(session.user.id)).toBeNull()
  })

  it('answers 422 ai_refused on a refusal without retrying', async () => {
    const { session, threadId } = await setup('question [fake:guide-refuse]')
    const res = await generate(session, threadId)
    expect(res.status).toBe(422)
    expectContract(res, 'post', '/api/thread/{id}/guide')
    const { error } = res.body as ErrorBody
    expect(error.code).toBe('ai_refused')
    expect(error.message).toBe("The tutor can't help with that question. Try rephrasing it.")
    const calls = await guideCalls(session.user.id)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ stop_reason: 'refusal', refusal_category: 'cyber' })
    expect(await guideCount(session.user.id)).toBe(0)
    expect(await lockOf(session.user.id)).toBeNull()
  })

  it('answers 502 ai_provider_error when the provider throws, and records the call', async () => {
    const { session, threadId } = await setup('question [fake:guide-error]')
    const res = await generate(session, threadId)
    expect(res.status).toBe(502)
    expectContract(res, 'post', '/api/thread/{id}/guide')
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('ai_provider_error')
    expect(JSON.stringify(body)).not.toContain('Fake provider error')
    const calls = await guideCalls(session.user.id)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ stop_reason: 'error', input_token: 0, output_token: 0 })
    expect(await guideCount(session.user.id)).toBe(0)
    expect(await lockOf(session.user.id)).toBeNull()
  })
})

describe('guards', () => {
  it('answers 409 thread_empty before any answer exists', async () => {
    const session = await signUp(client)
    const thread = (await client.post('/api/thread').set('Cookie', session.cookie).send({}))
      .body as { thread: { id: string } }
    const res = await generate(session, thread.thread.id)
    expect(res.status).toBe(409)
    expectContract(res, 'post', '/api/thread/{id}/guide')
    expect((res.body as ErrorBody).error.code).toBe('thread_empty')
    expect(ctx.tutor.guideCalls).toHaveLength(0)
    expect(await lockOf(session.user.id)).toBeNull()
  })

  it('answers 409 generation_in_progress while another generation holds the lock, and keeps it', async () => {
    const { session, threadId } = await setup()
    await sql`UPDATE app_user SET generation_started_at = now() WHERE id = ${session.user.id}`.execute(
      ctx.db
    )
    const res = await generate(session, threadId)
    expect(res.status).toBe(409)
    expectContract(res, 'post', '/api/thread/{id}/guide')
    expect((res.body as ErrorBody).error.code).toBe('generation_in_progress')
    expect(ctx.tutor.guideCalls).toHaveLength(0)
    // The other holder's lock is not ours to release.
    expect(await lockOf(session.user.id)).not.toBeNull()
  })

  it('answers 429 ai_budget_exceeded once today tokens reach the budget', async () => {
    const { session, threadId } = await setup()
    await sql`
      INSERT INTO ai_call (user_id, kind, model, input_token, output_token, cache_read_token,
        stop_reason, latency_ms, created_at)
      SELECT id, 'explain', 'fake', ${ctx.config.aiDailyTokenBudget}, 0, 0, 'end_turn', 1,
        (date_trunc('day', now() AT TIME ZONE time_zone) + interval '12 hours') AT TIME ZONE time_zone
      FROM app_user WHERE id = ${session.user.id}`.execute(ctx.db)
    const res = await generate(session, threadId)
    expect(res.status).toBe(429)
    expectContract(res, 'post', '/api/thread/{id}/guide')
    expect((res.body as ErrorBody).error.code).toBe('ai_budget_exceeded')
    expect(ctx.tutor.guideCalls).toHaveLength(0)
    expect(await lockOf(session.user.id)).toBeNull()
  })

  it('answers 503 ai_unavailable once the global daily cap is reached', async () => {
    const small = createTestApp({ config: { aiGlobalDailyTokenBudget: 1000 } })
    try {
      const smallClient = createClient(small.app, small.config)
      const session = await signUp(smallClient)
      const thread = (
        await smallClient
          .post('/api/thread')
          .set('Cookie', session.cookie)
          .send({ topicId: 'react' })
      ).body as { thread: { id: string } }
      const asked = await smallClient
        .post(`/api/thread/${thread.thread.id}/message`)
        .set('Cookie', session.cookie)
        .send({ content: 'Why does useEffect run twice?' })
      expect(asked.status).toBe(200)
      await sql`
        INSERT INTO ai_call (user_id, kind, model, input_token, output_token, cache_read_token,
          stop_reason, latency_ms)
        VALUES (${session.user.id}, 'explain', 'fake', 1000, 0, 0, 'end_turn', 1)`.execute(small.db)
      const res = await smallClient
        .post(`/api/thread/${thread.thread.id}/guide`)
        .set('Cookie', session.cookie)
      expect(res.status).toBe(503)
      expectContract(res, 'post', '/api/thread/{id}/guide')
      expect((res.body as ErrorBody).error.code).toBe('ai_unavailable')
      expect(small.tutor.guideCalls).toHaveLength(0)
    } finally {
      await small.close()
    }
  })

  it('answers 503 ai_unavailable when AI is disabled', async () => {
    const off = createTestApp({ config: { isAiEnabled: false } })
    try {
      const offClient = createClient(off.app, off.config)
      const { cookie } = await signUp(offClient)
      const res = await offClient.post('/api/thread/any-id/guide').set('Cookie', cookie)
      expect(res.status).toBe(503)
      expectContract(res, 'post', '/api/thread/{id}/guide')
      expect((res.body as ErrorBody).error.code).toBe('ai_unavailable')
      expect(off.tutor.guideCalls).toHaveLength(0)
    } finally {
      await off.close()
    }
  })

  it('answers 503 ai_unavailable, not 400, for an invalid body when AI is disabled', async () => {
    const off = createTestApp({ config: { isAiEnabled: false } })
    try {
      const offClient = createClient(off.app, off.config)
      const { cookie } = await signUp(offClient)
      const res = await offClient
        .post('/api/thread/any-id/guide')
        .set('Cookie', cookie)
        .send({ unexpected: 42 })
      expect(res.status).toBe(503)
      expect((res.body as ErrorBody).error.code).toBe('ai_unavailable')
      expect(off.tutor.guideCalls).toHaveLength(0)
    } finally {
      await off.close()
    }
  })

  it('answers 400 validation_failed on an empty or unknown PATCH body', async () => {
    const { session, threadId } = await setup()
    const guide = await createdGuide(session, threadId)
    const path = `/api/guide/${guide.id}/step/${guide.steps[0]?.id}`
    for (const body of [
      {},
      { isHintRevealed: false },
      { isDone: 'yes' },
      // The pre-rename field name is rejected, not silently ignored.
      { done: true },
      { extra: 1 }
    ]) {
      const res = await client.patch(path).set('Cookie', session.cookie).send(body)
      expect(res.status).toBe(400)
      expectContract(res, 'patch', '/api/guide/{id}/step/{stepId}')
      expect((res.body as ErrorBody).error.code).toBe('validation_failed')
    }
  })

  it('answers 401 without a session', async () => {
    const getRes = await client.get('/api/guide/x')
    expect(getRes.status).toBe(401)
    expectContract(getRes, 'get', '/api/guide/{id}')
    const patchRes = await client.patch('/api/guide/x/step/y').send({ isDone: true })
    expect(patchRes.status).toBe(401)
    expectContract(patchRes, 'patch', '/api/guide/{id}/step/{stepId}')
    const postRes = await client.post('/api/thread/x/guide')
    expect(postRes.status).toBe(401)
    expectContract(postRes, 'post', '/api/thread/{id}/guide')
  })
})

// Cross-user ownership (AC03) is proven in ownership.test.ts.
describe('scoping and soft delete', () => {
  it('hides the guide and its steps once the thread is soft-deleted', async () => {
    const { session, threadId } = await setup()
    const guide = await createdGuide(session, threadId)
    const del = await client.delete(`/api/thread/${threadId}`).set('Cookie', session.cookie)
    expect(del.status).toBe(204)

    const read = await client.get(`/api/guide/${guide.id}`).set('Cookie', session.cookie)
    expect(read.status).toBe(404)
    expectContract(read, 'get', '/api/guide/{id}')
    const patch = await client
      .patch(`/api/guide/${guide.id}/step/${guide.steps[0]?.id}`)
      .set('Cookie', session.cookie)
      .send({ isDone: true })
    expect(patch.status).toBe(404)
    expectContract(patch, 'patch', '/api/guide/{id}/step/{stepId}')
    // The row is untouched.
    const step = await ctx.db
      .selectFrom('guide_step')
      .select('done_at')
      .where('id', '=', guide.steps[0]?.id ?? '')
      .executeTakeFirstOrThrow()
    expect(step.done_at).toBeNull()
  })

  it('answers 404 from the no-change branch of updateStep on a soft-deleted thread', async () => {
    const { session, threadId } = await setup()
    const guide = await createdGuide(session, threadId)
    const stepId = guide.steps[0]?.id ?? ''
    const auth = { userId: session.user.id }
    // The route rejects an empty body, so the read-only branch is exercised through the service.
    await expect(guideService.updateStep(auth, guide.id, stepId, {})).resolves.toMatchObject({
      id: stepId
    })
    await client.delete(`/api/thread/${threadId}`).set('Cookie', session.cookie)
    await expect(guideService.updateStep(auth, guide.id, stepId, {})).rejects.toMatchObject({
      status: 404
    })
  })

  it('answers 404 for a step that is not in the guide', async () => {
    const { session, threadId } = await setup()
    const first = await createdGuide(session, threadId)
    const second = await createdGuide(session, threadId)
    const res = await client
      .patch(`/api/guide/${first.id}/step/${second.steps[0]?.id}`)
      .set('Cookie', session.cookie)
      .send({ isDone: true })
    expect(res.status).toBe(404)
    expectContract(res, 'patch', '/api/guide/{id}/step/{stepId}')
    const missing = await client.get('/api/guide/does-not-exist').set('Cookie', session.cookie)
    expect(missing.status).toBe(404)
  })
})
