import { sql } from 'kysely'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp } from '../helper/client.js'
import { expectContract, expectSchema } from '../helper/contract.js'

const ctx = createTestApp()
const client = createClient(ctx.app, ctx.config)

type ItemBody = { id: string; position: number; prompt: string; choices: string[] }
type AttemptSummaryBody = { id: string; score: number; total: number; submittedAt: string }
type QuizBody = {
  id: string
  threadId: string | null
  topicId: string
  difficulty: string
  items: ItemBody[]
  attempts: AttemptSummaryBody[]
}
type GradedBody = {
  itemId: string
  position: number
  choiceIndex: number
  answerIndex: number
  correct: boolean
  explanation: string
}
type AttemptBody = { id: string; quizId: string; score: number; total: number; items: GradedBody[] }
type ErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown> }
  requestId: string
}
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

function generate(session: Session, body: Record<string, unknown>) {
  return client.post('/api/quiz').set('Cookie', session.cookie).send(body)
}

async function createdQuiz(session: Session, body: Record<string, unknown>): Promise<QuizBody> {
  const res = await generate(session, body)
  expect(res.status).toBe(201)
  return (res.body as { quiz: QuizBody }).quiz
}

/** The stored answer key, by item id. */
async function keyOf(quizId: string): Promise<Map<string, number>> {
  const rows = await ctx.db
    .selectFrom('quiz_item')
    .select(['id', 'answer_index'])
    .where('quiz_id', '=', quizId)
    .execute()
  return new Map(rows.map((row) => [row.id, row.answer_index]))
}

function answersFor(quiz: QuizBody, choose: (item: ItemBody) => number) {
  return quiz.items.map((item) => ({ itemId: item.id, choiceIndex: choose(item) }))
}

function attempt(session: Session, quizId: string, answers: unknown) {
  return client.post(`/api/quiz/${quizId}/attempt`).set('Cookie', session.cookie).send({ answers })
}

async function quizCalls(userId: string) {
  return ctx.db
    .selectFrom('ai_call')
    .selectAll()
    .where('user_id', '=', userId)
    .where('kind', '=', 'quiz')
    .execute()
}

async function quizCount(userId: string): Promise<number> {
  const rows = await ctx.db.selectFrom('quiz').select('id').where('user_id', '=', userId).execute()
  return rows.length
}

async function lockOf(userId: string): Promise<Date | null> {
  const row = await ctx.db
    .selectFrom('app_user')
    .select('generation_started_at')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow()
  return row.generation_started_at
}

describe('quiz generation and the taker view (AC07)', () => {
  it('generates a quiz from a thread: 5 items with 4 choices and no answer key', async () => {
    const { session, threadId } = await setup()
    const res = await generate(session, { threadId, difficulty: 'hard' })
    expect(res.status).toBe(201)
    expectContract(res, 'post', '/api/quiz')
    const quiz = (res.body as { quiz: QuizBody }).quiz
    expect(quiz).toMatchObject({ threadId, topicId: 'react', difficulty: 'hard', attempts: [] })
    expect(quiz.items.map((item) => item.position)).toEqual([1, 2, 3, 4, 5])
    expect(quiz.items.every((item) => item.choices.length === 4)).toBe(true)
    const raw = JSON.stringify(res.body)
    expect(raw).not.toContain('answerIndex')
    expect(raw).not.toContain('answer_index')
    expect(raw).not.toContain('explanation')
    expect(ctx.tutor.quizCalls).toHaveLength(1)
    expect(ctx.tutor.quizCalls[0]).toMatchObject({ topicName: 'React', difficulty: 'hard' })
    expect(ctx.tutor.quizCalls[0]?.history).not.toBeNull()
    expect(await lockOf(session.user.id)).toBeNull()
  })

  it('defaults the difficulty of a thread quiz to medium', async () => {
    const { session, threadId } = await setup()
    const quiz = await createdQuiz(session, { threadId })
    expect(quiz.difficulty).toBe('medium')
  })

  it('generates a quiz from a topic and sends no history', async () => {
    const session = await signUp(client)
    const res = await generate(session, { topicId: 'sql', difficulty: 'easy' })
    expect(res.status).toBe(201)
    expectContract(res, 'post', '/api/quiz')
    const quiz = (res.body as { quiz: QuizBody }).quiz
    expect(quiz).toMatchObject({ threadId: null, topicId: 'sql', difficulty: 'easy' })
    expect(quiz.items).toHaveLength(5)
    expect(quiz.items.every((item) => item.choices.length === 4)).toBe(true)
    expect(JSON.stringify(res.body)).not.toMatch(/answerIndex|answer_index|explanation/)
    expect(ctx.tutor.quizCalls).toEqual([{ topicName: 'SQL', difficulty: 'easy', history: null }])
  })

  it('returns the same taker view by id, without the answer key', async () => {
    const { session, threadId } = await setup()
    const quiz = await createdQuiz(session, { threadId })
    const res = await client.get(`/api/quiz/${quiz.id}`).set('Cookie', session.cookie)
    expect(res.status).toBe(200)
    expectContract(res, 'get', '/api/quiz/{id}')
    expect((res.body as { quiz: QuizBody }).quiz).toEqual(quiz)
    const raw = JSON.stringify(res.body)
    expect(raw).not.toContain('answerIndex')
    expect(raw).not.toContain('explanation')
    // Even after an attempt, the taker view stays free of the key.
    await attempt(
      session,
      quiz.id,
      answersFor(quiz, () => 0)
    )
    const again = await client.get(`/api/quiz/${quiz.id}`).set('Cookie', session.cookie)
    expect(JSON.stringify(again.body)).not.toMatch(/answerIndex|answer_index|explanation/)
  })

  it('records one quiz ai_call for a successful generation', async () => {
    const { session, threadId } = await setup()
    await createdQuiz(session, { threadId })
    const calls = await quizCalls(session.user.id)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ model: 'fake', stop_reason: 'end_turn' })
  })
})

describe('attempts and grading', () => {
  it('grades a full attempt on the server and matches the stored key', async () => {
    const { session, threadId } = await setup()
    const quiz = await createdQuiz(session, { threadId })
    const key = await keyOf(quiz.id)
    // Right on the first three items, wrong on the last two.
    const answers = answersFor(quiz, (item) => {
      const answer = key.get(item.id) ?? 0
      return item.position <= 3 ? answer : (answer + 1) % 4
    })
    const res = await attempt(session, quiz.id, answers)
    expect(res.status).toBe(201)
    expectContract(res, 'post', '/api/quiz/{id}/attempt')
    const graded = (res.body as { attempt: AttemptBody }).attempt
    expect(graded).toMatchObject({ quizId: quiz.id, score: 3, total: 5 })
    expect(graded.items.map((item) => item.position)).toEqual([1, 2, 3, 4, 5])
    for (const item of graded.items) {
      expect(item.answerIndex).toBe(key.get(item.itemId))
      expect(item.correct).toBe(item.position <= 3)
      expect(item.explanation.length).toBeGreaterThan(0)
    }
    expect(graded.items.map((item) => item.choiceIndex)).toEqual(
      answers.map((answer) => answer.choiceIndex)
    )

    const read = await client
      .get(`/api/quiz/${quiz.id}/attempt/${graded.id}`)
      .set('Cookie', session.cookie)
    expect(read.status).toBe(200)
    expectContract(read, 'get', '/api/quiz/{id}/attempt/{attemptId}')
    expect((read.body as { attempt: AttemptBody }).attempt).toEqual(graded)
  })

  it('scores 5 when every answer is right and 0 when every answer is wrong', async () => {
    const { session, threadId } = await setup()
    const quiz = await createdQuiz(session, { threadId })
    const key = await keyOf(quiz.id)
    const perfect = await attempt(
      session,
      quiz.id,
      answersFor(quiz, (item) => key.get(item.id) ?? 0)
    )
    expect((perfect.body as { attempt: AttemptBody }).attempt.score).toBe(5)
    const zero = await attempt(
      session,
      quiz.id,
      answersFor(quiz, (item) => ((key.get(item.id) ?? 0) + 1) % 4)
    )
    expect((zero.body as { attempt: AttemptBody }).attempt.score).toBe(0)
  })

  it('accepts the answers in any order', async () => {
    const { session, threadId } = await setup()
    const quiz = await createdQuiz(session, { threadId })
    const key = await keyOf(quiz.id)
    const answers = answersFor(quiz, (item) => key.get(item.id) ?? 0).reverse()
    const res = await attempt(session, quiz.id, answers)
    expect(res.status).toBe(201)
    const graded = (res.body as { attempt: AttemptBody }).attempt
    expect(graded.score).toBe(5)
    expect(graded.items.map((item) => item.position)).toEqual([1, 2, 3, 4, 5])
  })

  it('answers 422 attempt_incomplete for a partial attempt and lists the missing ids', async () => {
    const { session, threadId } = await setup()
    const quiz = await createdQuiz(session, { threadId })
    const res = await attempt(session, quiz.id, answersFor(quiz, () => 0).slice(0, 3))
    expect(res.status).toBe(422)
    expectContract(res, 'post', '/api/quiz/{id}/attempt')
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('attempt_incomplete')
    expect((body.error as { message?: string }).message).toBe(
      'Answer every quiz item exactly once.'
    )
    expect(body.error.details).toEqual({
      missingItemIds: quiz.items.slice(3).map((item) => item.id)
    })
    const stored = await ctx.db.selectFrom('quiz_attempt').select('id').execute()
    expect(stored).toHaveLength(0)
  })

  it('answers 422 attempt_incomplete for an empty attempt', async () => {
    const { session, threadId } = await setup()
    const quiz = await createdQuiz(session, { threadId })
    const res = await attempt(session, quiz.id, [])
    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details?.missingItemIds).toHaveLength(5)
  })

  it('answers 422 for a duplicated item id and for an unknown one', async () => {
    const { session, threadId } = await setup()
    const quiz = await createdQuiz(session, { threadId })
    const full = answersFor(quiz, () => 0)
    const first = quiz.items[0] as ItemBody

    const duplicate = await attempt(session, quiz.id, [...full.slice(0, 4), full[0]])
    expect(duplicate.status).toBe(422)
    expectContract(duplicate, 'post', '/api/quiz/{id}/attempt')
    expect((duplicate.body as ErrorBody).error).toMatchObject({
      code: 'attempt_incomplete',
      details: {
        missingItemIds: [quiz.items[4]?.id],
        duplicateItemIds: [first.id]
      }
    })

    const unknown = await attempt(session, quiz.id, [
      ...full.slice(0, 4),
      { itemId: 'not-an-item', choiceIndex: 0 }
    ])
    expect(unknown.status).toBe(422)
    expect((unknown.body as ErrorBody).error).toMatchObject({
      code: 'attempt_incomplete',
      details: { missingItemIds: [quiz.items[4]?.id], unknownItemIds: ['not-an-item'] }
    })
    expect(await ctx.db.selectFrom('quiz_attempt').select('id').execute()).toHaveLength(0)
  })

  it('answers 400 for a malformed attempt body', async () => {
    const { session, threadId } = await setup()
    const quiz = await createdQuiz(session, { threadId })
    const item = quiz.items[0] as ItemBody
    for (const body of [
      {},
      { answers: 'x' },
      { answers: [{ itemId: item.id, choiceIndex: 4 }] },
      { answers: [{ itemId: item.id, choiceIndex: -1 }] },
      { answers: [{ itemId: item.id }] },
      { answers: [{ itemId: item.id, choiceIndex: 0, extra: 1 }] },
      { answers: Array.from({ length: 6 }, () => ({ itemId: item.id, choiceIndex: 0 })) },
      { answers: [], extra: 1 }
    ]) {
      const res = await client
        .post(`/api/quiz/${quiz.id}/attempt`)
        .set('Cookie', session.cookie)
        .send(body)
      expect(res.status).toBe(400)
      expectContract(res, 'post', '/api/quiz/{id}/attempt')
      expect((res.body as ErrorBody).error.code).toBe('validation_failed')
    }
  })

  it('lists retakes newest first and reports the best score in the thread detail', async () => {
    const { session, threadId } = await setup()
    const quiz = await createdQuiz(session, { threadId })
    const key = await keyOf(quiz.id)
    const score = async (right: number) => {
      const res = await attempt(
        session,
        quiz.id,
        answersFor(quiz, (item) => {
          const answer = key.get(item.id) ?? 0
          return item.position <= right ? answer : (answer + 1) % 4
        })
      )
      expect(res.status).toBe(201)
      return (res.body as { attempt: AttemptBody }).attempt
    }
    const first = await score(2)
    const second = await score(4)
    const third = await score(1)

    const read = await client.get(`/api/quiz/${quiz.id}`).set('Cookie', session.cookie)
    expectContract(read, 'get', '/api/quiz/{id}')
    const attempts = (read.body as { quiz: QuizBody }).quiz.attempts
    expect(attempts.map((entry) => entry.id)).toEqual([third.id, second.id, first.id])
    expect(attempts.map((entry) => entry.score)).toEqual([1, 4, 2])
    expectSchema(attempts[0], 'AttemptSummary')

    const detail = await client.get(`/api/thread/${threadId}`).set('Cookie', session.cookie)
    expectContract(detail, 'get', '/api/thread/{id}')
    const { quizzes } = detail.body as {
      quizzes: { id: string; difficulty: string; itemCount: number; bestScore: number | null }[]
    }
    expectSchema(quizzes[0], 'QuizSummary')
    expect(quizzes[0]).toMatchObject({
      id: quiz.id,
      difficulty: 'medium',
      itemCount: 5,
      bestScore: 4
    })
  })

  it('lists the thread quizzes newest first, with a null bestScore before any attempt', async () => {
    const { session, threadId } = await setup()
    const first = await createdQuiz(session, { threadId })
    const second = await createdQuiz(session, { threadId, difficulty: 'easy' })
    const detail = await client.get(`/api/thread/${threadId}`).set('Cookie', session.cookie)
    const { quizzes } = detail.body as { quizzes: { id: string; bestScore: number | null }[] }
    expect(quizzes.map((quiz) => quiz.id)).toEqual([second.id, first.id])
    expect(quizzes.every((quiz) => quiz.bestScore === null)).toBe(true)
  })

  it('answers 404 for an attempt of another quiz', async () => {
    const { session, threadId } = await setup()
    const first = await createdQuiz(session, { threadId })
    const second = await createdQuiz(session, { threadId })
    const res = await attempt(
      session,
      first.id,
      answersFor(first, () => 0)
    )
    const attemptId = (res.body as { attempt: AttemptBody }).attempt.id
    const wrong = await client
      .get(`/api/quiz/${second.id}/attempt/${attemptId}`)
      .set('Cookie', session.cookie)
    expect(wrong.status).toBe(404)
    expectContract(wrong, 'get', '/api/quiz/{id}/attempt/{attemptId}')
    const missing = await client
      .get(`/api/quiz/${first.id}/attempt/does-not-exist`)
      .set('Cookie', session.cookie)
    expect(missing.status).toBe(404)
  })
})

describe('soft-deleted threads', () => {
  it('hides a thread quiz, its attempts and attempt submission once the thread is deleted', async () => {
    const { session, threadId } = await setup()
    const quiz = await createdQuiz(session, { threadId })
    const graded = await attempt(
      session,
      quiz.id,
      answersFor(quiz, () => 0)
    )
    const attemptId = (graded.body as { attempt: AttemptBody }).attempt.id
    expect(
      (await client.delete(`/api/thread/${threadId}`).set('Cookie', session.cookie)).status
    ).toBe(204)

    const read = await client.get(`/api/quiz/${quiz.id}`).set('Cookie', session.cookie)
    expect(read.status).toBe(404)
    expectContract(read, 'get', '/api/quiz/{id}')
    const submit = await attempt(
      session,
      quiz.id,
      answersFor(quiz, () => 0)
    )
    expect(submit.status).toBe(404)
    expectContract(submit, 'post', '/api/quiz/{id}/attempt')
    const reread = await client
      .get(`/api/quiz/${quiz.id}/attempt/${attemptId}`)
      .set('Cookie', session.cookie)
    expect(reread.status).toBe(404)
    expectContract(reread, 'get', '/api/quiz/{id}/attempt/{attemptId}')
  })

  it('does not hide a topic-only quiz when some thread is deleted', async () => {
    const { session, threadId } = await setup()
    const quiz = await createdQuiz(session, { topicId: 'react', difficulty: 'easy' })
    await client.delete(`/api/thread/${threadId}`).set('Cookie', session.cookie)
    const res = await client.get(`/api/quiz/${quiz.id}`).set('Cookie', session.cookie)
    expect(res.status).toBe(200)
  })
})

describe('invalid output, refusal and provider errors (AC10)', () => {
  it('answers 502 ai_invalid_output after exactly two calls when the output stays invalid', async () => {
    const { session, threadId } = await setup('question [fake:quiz-invalid]')
    const res = await generate(session, { threadId })
    expect(res.status).toBe(502)
    expectContract(res, 'post', '/api/quiz')
    expect((res.body as ErrorBody).error.code).toBe('ai_invalid_output')
    expect(await quizCalls(session.user.id)).toHaveLength(2)
    expect(ctx.tutor.quizCalls).toHaveLength(2)
    expect(await quizCount(session.user.id)).toBe(0)
    expect(await lockOf(session.user.id)).toBeNull()
  })

  it('succeeds after one retry when the first output is invalid', async () => {
    const { session, threadId } = await setup('question [fake:quiz-invalid-once]')
    const res = await generate(session, { threadId })
    expect(res.status).toBe(201)
    expectContract(res, 'post', '/api/quiz')
    expect(await quizCalls(session.user.id)).toHaveLength(2)
    expect(await quizCount(session.user.id)).toBe(1)
    expect(await lockOf(session.user.id)).toBeNull()
  })

  it('answers 422 ai_refused on a refusal without retrying', async () => {
    const { session, threadId } = await setup('question [fake:quiz-refuse]')
    const res = await generate(session, { threadId })
    expect(res.status).toBe(422)
    expectContract(res, 'post', '/api/quiz')
    const { error } = res.body as ErrorBody
    expect(error.code).toBe('ai_refused')
    expect(error.message).toBe("The tutor can't help with that question. Try rephrasing it.")
    const calls = await quizCalls(session.user.id)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ stop_reason: 'refusal', refusal_category: 'cyber' })
    expect(await quizCount(session.user.id)).toBe(0)
    expect(await lockOf(session.user.id)).toBeNull()
  })

  it('answers 502 ai_provider_error when the provider throws, and records the call', async () => {
    const { session, threadId } = await setup('question [fake:quiz-error]')
    const res = await generate(session, { threadId })
    expect(res.status).toBe(502)
    expectContract(res, 'post', '/api/quiz')
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('ai_provider_error')
    expect(JSON.stringify(body)).not.toContain('Fake provider error')
    const calls = await quizCalls(session.user.id)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ stop_reason: 'error', input_token: 0, output_token: 0 })
    expect(await quizCount(session.user.id)).toBe(0)
    expect(await lockOf(session.user.id)).toBeNull()
  })
})

describe('guards', () => {
  it('answers 400 for an unknown topic', async () => {
    const session = await signUp(client)
    const res = await generate(session, { topicId: 'cobol', difficulty: 'easy' })
    expect(res.status).toBe(400)
    expectContract(res, 'post', '/api/quiz')
    expect((res.body as ErrorBody).error.code).toBe('validation_failed')
    expect(ctx.tutor.quizCalls).toHaveLength(0)
  })

  it('answers 400 for a bad body: both ids, neither id, bad difficulty, missing difficulty', async () => {
    const { session, threadId } = await setup()
    for (const body of [
      { threadId, topicId: 'react', difficulty: 'easy' },
      {},
      { difficulty: 'easy' },
      { threadId, difficulty: 'impossible' },
      { topicId: 'react', difficulty: 'impossible' },
      { topicId: 'react' },
      { threadId, extra: 1 }
    ]) {
      const res = await generate(session, body)
      expect(res.status).toBe(400)
      expectContract(res, 'post', '/api/quiz')
      expect((res.body as ErrorBody).error.code).toBe('validation_failed')
    }
    expect(ctx.tutor.quizCalls).toHaveLength(0)
  })

  it('answers 404 for an unknown thread', async () => {
    const session = await signUp(client)
    const res = await generate(session, { threadId: 'nope' })
    expect(res.status).toBe(404)
    expectContract(res, 'post', '/api/quiz')
  })

  it('answers 409 thread_empty before any answer exists', async () => {
    const session = await signUp(client)
    const thread = (await client.post('/api/thread').set('Cookie', session.cookie).send({}))
      .body as { thread: { id: string } }
    const res = await generate(session, { threadId: thread.thread.id })
    expect(res.status).toBe(409)
    expectContract(res, 'post', '/api/quiz')
    expect((res.body as ErrorBody).error.code).toBe('thread_empty')
    expect(ctx.tutor.quizCalls).toHaveLength(0)
    expect(await lockOf(session.user.id)).toBeNull()
  })

  it('answers 409 generation_in_progress while another generation holds the lock, and keeps it', async () => {
    const { session, threadId } = await setup()
    await sql`UPDATE app_user SET generation_started_at = now() WHERE id = ${session.user.id}`.execute(
      ctx.db
    )
    const res = await generate(session, { threadId })
    expect(res.status).toBe(409)
    expectContract(res, 'post', '/api/quiz')
    expect((res.body as ErrorBody).error.code).toBe('generation_in_progress')
    expect(ctx.tutor.quizCalls).toHaveLength(0)
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
    const res = await generate(session, { threadId })
    expect(res.status).toBe(429)
    expectContract(res, 'post', '/api/quiz')
    expect((res.body as ErrorBody).error.code).toBe('ai_budget_exceeded')
    expect(ctx.tutor.quizCalls).toHaveLength(0)
    expect(await lockOf(session.user.id)).toBeNull()
  })

  it('answers 503 ai_unavailable when AI is disabled, before looking at the body', async () => {
    const off = createTestApp({ config: { isAiEnabled: false } })
    try {
      const offClient = createClient(off.app, off.config)
      const { cookie } = await signUp(offClient)
      for (const body of [{ topicId: 'react', difficulty: 'easy' }, {}]) {
        const res = await offClient.post('/api/quiz').set('Cookie', cookie).send(body)
        expect(res.status).toBe(503)
        expectContract(res, 'post', '/api/quiz')
        expect((res.body as ErrorBody).error.code).toBe('ai_unavailable')
      }
      expect(off.tutor.quizCalls).toHaveLength(0)
    } finally {
      await off.close()
    }
  })

  it('answers 401 without a session', async () => {
    const create = await client.post('/api/quiz').send({ topicId: 'react', difficulty: 'easy' })
    expect(create.status).toBe(401)
    expectContract(create, 'post', '/api/quiz')
    const read = await client.get('/api/quiz/x')
    expect(read.status).toBe(401)
    expectContract(read, 'get', '/api/quiz/{id}')
    const submit = await client.post('/api/quiz/x/attempt').send({ answers: [] })
    expect(submit.status).toBe(401)
    expectContract(submit, 'post', '/api/quiz/{id}/attempt')
    const reread = await client.get('/api/quiz/x/attempt/y')
    expect(reread.status).toBe(401)
    expectContract(reread, 'get', '/api/quiz/{id}/attempt/{attemptId}')
  })
})
