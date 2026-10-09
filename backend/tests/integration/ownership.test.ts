import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp } from '../helper/client.js'
import { expectContract } from '../helper/contract.js'

/**
 * AC03, the single proof: user B gets 404 (never 403) on every read and write of user A's
 * thread, guide, quiz and attempt, nothing of A's changes, and B's attempts cost no AI call.
 */
const ctx = createTestApp()
const client = createClient(ctx.app, ctx.config)

type ErrorBody = { error: { code: string }; requestId: string }
type Session = Awaited<ReturnType<typeof signUp>>
type Call = (cookie: string) => ReturnType<typeof client.get>
type Probe = { name: string; method: string; template: string; call: Call }

beforeEach(async () => {
  await truncateAll(ctx.db)
  ctx.tutor.reset()
})
afterAll(() => ctx.close())

/** User A with a thread (one answer), a guide, a quiz and a graded attempt on that quiz. */
async function seedA(a: Session) {
  const cookie = a.cookie
  const thread = (await client.post('/api/thread').set('Cookie', cookie).send({ topicId: 'react' }))
    .body as { thread: { id: string; title: string } }
  const threadId = thread.thread.id
  const asked = await client
    .post(`/api/thread/${threadId}/message`)
    .set('Cookie', cookie)
    .send({ content: 'Why does useEffect run twice?' })
  expect(asked.status).toBe(200)
  // The first question titles the thread.
  const titled = (await client.get(`/api/thread/${threadId}`).set('Cookie', cookie)).body as {
    thread: { title: string }
  }
  const guide = (await client.post(`/api/thread/${threadId}/guide`).set('Cookie', cookie)).body as {
    guide: { id: string; steps: { id: string }[] }
  }
  const quiz = (await client.post('/api/quiz').set('Cookie', cookie).send({ threadId })).body as {
    quiz: { id: string; items: { id: string }[] }
  }
  const graded = (
    await client
      .post(`/api/quiz/${quiz.quiz.id}/attempt`)
      .set('Cookie', cookie)
      .send({ answers: quiz.quiz.items.map((item) => ({ itemId: item.id, choiceIndex: 0 })) })
  ).body as { attempt: { id: string } }
  return {
    threadId,
    title: titled.thread.title,
    guideId: guide.guide.id,
    stepId: guide.guide.steps[0]?.id ?? '',
    quizId: quiz.quiz.id,
    items: quiz.quiz.items,
    attemptId: graded.attempt.id
  }
}

describe('ownership (AC03)', () => {
  it("answers 404, never 403, for every read and write of another user's data", async () => {
    const a = await signUp(client)
    const b = await signUp(client)
    const seed = await seedA(a)
    const providerCalls = {
      explain: ctx.tutor.calls.length,
      guide: ctx.tutor.guideCalls.length,
      quiz: ctx.tutor.quizCalls.length
    }
    const answers = seed.items.map((item) => ({ itemId: item.id, choiceIndex: 1 }))

    const probes: Probe[] = [
      {
        name: 'GET thread',
        method: 'get',
        template: '/api/thread/{id}',
        call: (c) => client.get(`/api/thread/${seed.threadId}`).set('Cookie', c)
      },
      {
        name: 'PATCH thread',
        method: 'patch',
        template: '/api/thread/{id}',
        call: (c) =>
          client.patch(`/api/thread/${seed.threadId}`).set('Cookie', c).send({ title: 'mine now' })
      },
      {
        name: 'DELETE thread',
        method: 'delete',
        template: '/api/thread/{id}',
        call: (c) => client.delete(`/api/thread/${seed.threadId}`).set('Cookie', c)
      },
      {
        name: 'POST ask',
        method: 'post',
        template: '/api/thread/{id}/message',
        call: (c) =>
          client
            .post(`/api/thread/${seed.threadId}/message`)
            .set('Cookie', c)
            .send({ content: 'hello' })
      },
      {
        name: 'GET guide',
        method: 'get',
        template: '/api/guide/{id}',
        call: (c) => client.get(`/api/guide/${seed.guideId}`).set('Cookie', c)
      },
      {
        name: 'PATCH guide step',
        method: 'patch',
        template: '/api/guide/{id}/step/{stepId}',
        call: (c) =>
          client
            .patch(`/api/guide/${seed.guideId}/step/${seed.stepId}`)
            .set('Cookie', c)
            .send({ isDone: true })
      },
      {
        name: 'POST guide on the thread',
        method: 'post',
        template: '/api/thread/{id}/guide',
        call: (c) => client.post(`/api/thread/${seed.threadId}/guide`).set('Cookie', c)
      },
      {
        name: 'POST quiz from the thread',
        method: 'post',
        template: '/api/quiz',
        call: (c) => client.post('/api/quiz').set('Cookie', c).send({ threadId: seed.threadId })
      },
      {
        name: 'GET quiz',
        method: 'get',
        template: '/api/quiz/{id}',
        call: (c) => client.get(`/api/quiz/${seed.quizId}`).set('Cookie', c)
      },
      {
        name: 'POST attempt',
        method: 'post',
        template: '/api/quiz/{id}/attempt',
        call: (c) =>
          client.post(`/api/quiz/${seed.quizId}/attempt`).set('Cookie', c).send({ answers })
      },
      {
        name: 'GET attempt',
        method: 'get',
        template: '/api/quiz/{id}/attempt/{attemptId}',
        call: (c) =>
          client.get(`/api/quiz/${seed.quizId}/attempt/${seed.attemptId}`).set('Cookie', c)
      }
    ]

    for (const probe of probes) {
      const res = await probe.call(b.cookie)
      expect(res.status, probe.name).toBe(404)
      expect((res.body as ErrorBody).error.code, probe.name).toBe('not_found')
      expectContract(res, probe.method, probe.template)
    }

    // B's calls reached no provider and cost no ai_call row; B holds no lock.
    expect(ctx.tutor.calls).toHaveLength(providerCalls.explain)
    expect(ctx.tutor.guideCalls).toHaveLength(providerCalls.guide)
    expect(ctx.tutor.quizCalls).toHaveLength(providerCalls.quiz)
    expect(
      await ctx.db.selectFrom('ai_call').select('id').where('user_id', '=', b.user.id).execute()
    ).toHaveLength(0)
    const lock = await ctx.db
      .selectFrom('app_user')
      .select('generation_started_at')
      .where('id', '=', b.user.id)
      .executeTakeFirstOrThrow()
    expect(lock.generation_started_at).toBeNull()

    // A's data is untouched and still reachable by A.
    const thread = await client.get(`/api/thread/${seed.threadId}`).set('Cookie', a.cookie)
    expect(thread.status).toBe(200)
    expect(
      (thread.body as { thread: { title: string }; guides: unknown[]; quizzes: unknown[] }).thread
        .title
    ).toBe(seed.title)
    expect((thread.body as { messages: unknown[] }).messages).toHaveLength(2)
    expect((thread.body as { guides: unknown[] }).guides).toHaveLength(1)
    expect((thread.body as { quizzes: unknown[] }).quizzes).toHaveLength(1)
    const guide = await client.get(`/api/guide/${seed.guideId}`).set('Cookie', a.cookie)
    expect(
      (guide.body as { guide: { steps: { doneAt: string | null }[] } }).guide.steps[0]?.doneAt
    ).toBeNull()
    const quiz = await client.get(`/api/quiz/${seed.quizId}`).set('Cookie', a.cookie)
    expect((quiz.body as { quiz: { attempts: unknown[] } }).quiz.attempts).toHaveLength(1)
    const attempt = await client
      .get(`/api/quiz/${seed.quizId}/attempt/${seed.attemptId}`)
      .set('Cookie', a.cookie)
    expect(attempt.status).toBe(200)
  })

  it("does not leak A's data into B's own listings and details", async () => {
    const a = await signUp(client)
    const b = await signUp(client)
    await seedA(a)
    const list = await client.get('/api/thread').set('Cookie', b.cookie)
    expect(list.status).toBe(200)
    expect((list.body as { threads: unknown[] }).threads).toEqual([])

    // B's own thread shows none of A's guides or quizzes.
    const own = (await client.post('/api/thread').set('Cookie', b.cookie).send({})).body as {
      thread: { id: string }
    }
    const detail = await client.get(`/api/thread/${own.thread.id}`).set('Cookie', b.cookie)
    expect(detail.status).toBe(200)
    expect(detail.body).toMatchObject({ guides: [], quizzes: [], messages: [] })
  })

  it("answers 404 when B asks for A's attempt through B's own quiz", async () => {
    const a = await signUp(client)
    const b = await signUp(client)
    const seed = await seedA(a)
    const mine = await client
      .post('/api/quiz')
      .set('Cookie', b.cookie)
      .send({ topicId: 'react', difficulty: 'easy' })
    expect(mine.status).toBe(201)
    const myQuizId = (mine.body as { quiz: { id: string } }).quiz.id
    const res = await client
      .get(`/api/quiz/${myQuizId}/attempt/${seed.attemptId}`)
      .set('Cookie', b.cookie)
    expect(res.status).toBe(404)
    expectContract(res, 'get', '/api/quiz/{id}/attempt/{attemptId}')
  })
})
