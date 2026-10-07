import type { AddressInfo } from 'node:net'
import { sql } from 'kysely'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp } from '../helper/client.js'
import { expectContract, expectSchema } from '../helper/contract.js'
import { parseSse, type SseEvent } from '../helper/sse.js'
import { recoverStaleTurn } from '../../src/service/stale-turn.js'

const ctx = createTestApp()
const client = createClient(ctx.app, ctx.config)

type ThreadBody = { id: string; title: string; messageCount: number; updatedAt: string }
type MessageBody = {
  id: string
  role: string
  content: string
  status: string
  stopReason: string | null
}
type ErrorBody = { error: { code: string; details?: unknown }; requestId: string }
type Session = Awaited<ReturnType<typeof signUp>>

beforeEach(async () => {
  await truncateAll(ctx.db)
  ctx.tutor.reset()
})
afterAll(() => ctx.close())

async function newThread(cookie: string, body: Record<string, unknown> = {}) {
  const res = await client.post('/api/thread').set('Cookie', cookie).send(body)
  return (res.body as { thread: ThreadBody }).thread
}

async function ask(cookie: string, threadId: string, content: string) {
  const res = await client
    .post(`/api/thread/${threadId}/message`)
    .set('Cookie', cookie)
    .send({ content })
  return { res, events: res.status === 200 ? parseSse(res.text) : ([] as SseEvent[]) }
}

async function detail(cookie: string, threadId: string) {
  const res = await client.get(`/api/thread/${threadId}`).set('Cookie', cookie)
  expectContract(res, 'get', '/api/thread/{id}')
  return res.body as { thread: ThreadBody; messages: MessageBody[] }
}

async function lockOf(userId: string): Promise<Date | null> {
  const row = await ctx.db
    .selectFrom('app_user')
    .select('generation_started_at')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow()
  return row.generation_started_at
}

async function insertMessages(
  userId: string,
  threadId: string,
  rows: { role: 'user' | 'assistant'; status: 'complete' | 'failed' }[]
) {
  for (const row of rows) {
    await ctx.db
      .insertInto('message')
      .values({
        thread_id: threadId,
        user_id: userId,
        role: row.role,
        content: row.status === 'failed' ? '' : 'earlier text',
        status: row.status,
        stop_reason: row.status === 'failed' ? 'error' : 'end_turn'
      })
      .execute()
  }
}

const pairs = (count: number, status: 'complete' | 'failed') =>
  Array.from({ length: count }, () => [
    { role: 'user' as const, status },
    { role: 'assistant' as const, status }
  ]).flat()

async function aiCalls(userId: string) {
  return ctx.db
    .selectFrom('ai_call')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('created_at')
    .execute()
}

/**
 * Waits until the background turn of `userId` has fully settled: the lock is released and the
 * ai_call row exists. Both are written by the server after the client is gone, so a test must not
 * assert on them (or let the next test truncate the tables) before this returns.
 */
async function waitSettled(userId: string, expectedCalls = 1): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await lockOf(userId)) === null && (await aiCalls(userId)).length >= expectedCalls) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('the abandoned turn never settled')
}

/** Inserts an ai_call at the middle of the user's current local day, so midnight cannot flip it. */
async function insertSpend(userId: string, inputToken: number, outputToken: number) {
  await sql`
    INSERT INTO ai_call (user_id, kind, model, input_token, output_token, cache_read_token,
      stop_reason, latency_ms, created_at)
    SELECT id, 'explain', 'fake', ${inputToken}, ${outputToken}, 0, 'end_turn', 1,
      (date_trunc('day', now() AT TIME ZONE time_zone) + interval '12 hours') AT TIME ZONE time_zone
    FROM app_user WHERE id = ${userId}`.execute(ctx.db)
}

/** Opens a real SSE request with `[fake:slow]` and returns once the first delta has arrived. */
async function openSlowStream(cookie: string, threadId: string, userId: string, app = ctx.app) {
  const server = app.listen(0)
  const { port } = server.address() as AddressInfo
  const controller = new AbortController()
  const res = await fetch(`http://127.0.0.1:${port}/api/thread/${threadId}/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ctx.config.frontendUrl,
      Cookie: cookie
    },
    body: JSON.stringify({ content: 'slow question [fake:slow]' }),
    signal: controller.signal
  })
  expect(res.status).toBe(200)
  const reader = (res.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let seen = ''
  while (!seen.includes('event: delta')) {
    const chunk = await reader.read()
    if (chunk.done) break
    seen += decoder.decode(chunk.value)
  }
  expect(seen).toContain('event: delta')
  return {
    /**
     * Drops the connection like a closed browser tab, waits for the server to finish persisting
     * the abandoned turn, then stops the server.
     */
    async close() {
      try {
        controller.abort()
        await reader.cancel().catch(() => {})
        await waitSettled(userId)
      } finally {
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
      }
    },
    abortOnly() {
      controller.abort()
      return reader.cancel().catch(() => {})
    }
  }
}

async function setup(): Promise<{ session: Session; threadId: string }> {
  const session = await signUp(client)
  const thread = await newThread(session.cookie, { topicId: 'react' })
  return { session, threadId: thread.id }
}

describe('POST /api/thread/:id/message streaming (AC04)', () => {
  it('streams message.start, 2+ deltas and message.complete in order, then persists both messages', async () => {
    const { session, threadId } = await setup()
    const { res, events } = await ask(session.cookie, threadId, 'Why does useEffect run twice?')
    expect(res.status).toBe(200)
    expectContract(res, 'post', '/api/thread/{id}/message')
    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    expect(res.headers['cache-control']).toBe('no-cache, no-transform')
    expect(res.headers['x-accel-buffering']).toBe('no')

    const names = events.map((event) => event.event)
    expect(names[0]).toBe('message.start')
    expect(names.at(-1)).toBe('message.complete')
    expect(names.filter((name) => name === 'delta').length).toBeGreaterThanOrEqual(2)
    expect(names.filter((name) => name === 'message.complete')).toHaveLength(1)
    expect(names.slice(1, -1).every((name) => name === 'delta')).toBe(true)

    const [start, ...rest] = events
    expectSchema(start?.data, 'StreamMessageStart')
    for (const event of rest.slice(0, -1)) expectSchema(event.data, 'StreamDelta')
    const complete = rest.at(-1)?.data as {
      messageId: string
      status: string
      stopReason: string
      usage: unknown
    }
    expectSchema(complete, 'StreamMessageComplete')
    expect(complete).toMatchObject({ status: 'complete', stopReason: 'end_turn' })

    const text = rest
      .filter((event) => event.event === 'delta')
      .map((event) => (event.data as { text: string }).text)
      .join('')
    const { thread, messages } = await detail(session.cookie, threadId)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: 'Why does useEffect run twice?',
      status: 'complete'
    })
    expect(messages[1]).toMatchObject({
      id: complete.messageId,
      role: 'assistant',
      content: text,
      status: 'complete',
      stopReason: 'end_turn'
    })
    expect((start?.data as { assistantMessageId: string }).assistantMessageId).toBe(
      complete.messageId
    )
    expect(thread.messageCount).toBe(2)
  })

  it('sets the title from the first question line, trimmed to 80 chars, only once', async () => {
    const { session, threadId } = await setup()
    const long = 'a'.repeat(100)
    await ask(session.cookie, threadId, `  ${long}\nsecond line`)
    expect((await detail(session.cookie, threadId)).thread.title).toBe(`${'a'.repeat(79)}…`)
    await ask(session.cookie, threadId, 'a different question')
    expect((await detail(session.cookie, threadId)).thread.title).toBe(`${'a'.repeat(79)}…`)
  })

  it('cuts a long title at a word boundary and adds an ellipsis', async () => {
    const { session, threadId } = await setup()
    const words = Array.from({ length: 30 }, (_, index) => `word${index}`).join('   ')
    await ask(session.cookie, threadId, words)
    const { title } = (await detail(session.cookie, threadId)).thread
    expect(title.length).toBeLessThanOrEqual(80)
    expect(title.endsWith('…')).toBe(true)
    expect(title).toMatch(/word\d+…$/)
    expect(title).not.toMatch(/ {2}/)
  })

  it('skips a leading code fence and blank lines when titling the thread', async () => {
    const { session, threadId } = await setup()
    await ask(session.cookie, threadId, '\n```ts\nconst x = 1\n```\nwhy is x a number?')
    expect((await detail(session.cookie, threadId)).thread.title).toBe('const x = 1')
  })

  it('falls back to the default title when the question has only fences', async () => {
    const { session, threadId } = await setup()
    await ask(session.cookie, threadId, '```\n```')
    expect((await detail(session.cookie, threadId)).thread.title).toBe('New thread')
  })

  it('keeps a title the user already chose and bumps updated_at', async () => {
    const session = await signUp(client)
    const thread = await newThread(session.cookie, { title: 'My title' })
    await sql`UPDATE thread SET updated_at = now() - interval '1 hour' WHERE id = ${thread.id}`.execute(
      ctx.db
    )
    const before = await detail(session.cookie, thread.id)
    await ask(session.cookie, thread.id, 'hello')
    const after = await detail(session.cookie, thread.id)
    expect(after.thread.title).toBe('My title')
    expect(Date.parse(after.thread.updatedAt)).toBeGreaterThan(Date.parse(before.thread.updatedAt))
  })

  it('does not log or return the question to other users', async () => {
    const { session, threadId } = await setup()
    await ask(session.cookie, threadId, 'private question')
    const other = await signUp(client)
    const res = await client.get('/api/thread').set('Cookie', other.cookie)
    expect(res.text).not.toContain('private question')
  })
})

describe('follow-up context (AC05)', () => {
  it('sends the earlier question and answer, with the Topic prefix on the first user turn', async () => {
    const { session, threadId } = await setup()
    const first = await ask(session.cookie, threadId, 'first question')
    const answer = first.events
      .filter((event) => event.event === 'delta')
      .map((event) => (event.data as { text: string }).text)
      .join('')
    await ask(session.cookie, threadId, 'second question')
    expect(ctx.tutor.calls).toHaveLength(2)
    expect(ctx.tutor.calls[0]).toMatchObject({ topicName: 'React', history: [] })
    expect(ctx.tutor.calls[1]).toMatchObject({
      topicName: 'React',
      history: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: answer }
      ],
      question: 'second question'
    })
  })
})

describe('limits and locks (AC09)', () => {
  it('answers 429 ai_budget_exceeded once today tokens reach the budget', async () => {
    const { session, threadId } = await setup()
    await insertSpend(session.user.id, ctx.config.aiDailyTokenBudget - 10, 10)
    const { res } = await ask(session.cookie, threadId, 'hello')
    expect(res.status).toBe(429)
    expectContract(res, 'post', '/api/thread/{id}/message')
    expect((res.body as ErrorBody).error.code).toBe('ai_budget_exceeded')
    expect(await lockOf(session.user.id)).toBeNull()
    expect(ctx.tutor.calls).toHaveLength(0)
  })

  it('counts cache creation and cache read tokens toward the daily budget', async () => {
    const { session, threadId } = await setup()
    const budget = ctx.config.aiDailyTokenBudget
    await sql`
      INSERT INTO ai_call (user_id, kind, model, input_token, output_token, cache_read_token,
        cache_creation_token, stop_reason, latency_ms, created_at)
      SELECT id, 'explain', 'fake', 1, 1, ${Math.floor(budget / 2)}, ${Math.ceil(budget / 2)},
        'end_turn', 1,
        (date_trunc('day', now() AT TIME ZONE time_zone) + interval '12 hours') AT TIME ZONE time_zone
      FROM app_user WHERE id = ${session.user.id}`.execute(ctx.db)
    const { res } = await ask(session.cookie, threadId, 'hello')
    expect(res.status).toBe(429)
    expect((res.body as ErrorBody).error.code).toBe('ai_budget_exceeded')
    expect(ctx.tutor.calls).toHaveLength(0)
  })

  it('sums per-row token counts past the int4 range without overflowing', async () => {
    const { session, threadId } = await setup()
    const nearMax = 2_147_483_647
    await sql`
      INSERT INTO ai_call (user_id, kind, model, input_token, output_token, cache_read_token,
        cache_creation_token, stop_reason, latency_ms, created_at)
      SELECT id, 'explain', 'fake', ${nearMax}, ${nearMax}, 0, 0, 'end_turn', 1,
        (date_trunc('day', now() AT TIME ZONE time_zone) + interval '12 hours') AT TIME ZONE time_zone
      FROM app_user WHERE id = ${session.user.id}`.execute(ctx.db)
    const { res } = await ask(session.cookie, threadId, 'hello')
    expect(res.status).toBe(429)
    expect((res.body as ErrorBody).error.code).toBe('ai_budget_exceeded')
  })

  it('ignores tokens spent before the start of today in the user time zone', async () => {
    const { session, threadId } = await setup()
    await ctx.db
      .insertInto('ai_call')
      .values({
        user_id: session.user.id,
        kind: 'explain',
        model: 'fake',
        input_token: ctx.config.aiDailyTokenBudget,
        output_token: 0,
        cache_read_token: 0,
        stop_reason: 'end_turn',
        latency_ms: 1,
        created_at: new Date(Date.now() - 49 * 60 * 60 * 1000)
      })
      .execute()
    const { res } = await ask(session.cookie, threadId, 'hello')
    expect(res.status).toBe(200)
  })

  it('answers 409 generation_in_progress while the lock is held, and keeps it', async () => {
    const { session, threadId } = await setup()
    await sql`UPDATE app_user SET generation_started_at = now()`.execute(ctx.db)
    const { res } = await ask(session.cookie, threadId, 'hello')
    expect(res.status).toBe(409)
    expectContract(res, 'post', '/api/thread/{id}/message')
    expect((res.body as ErrorBody).error.code).toBe('generation_in_progress')
    expect(await lockOf(session.user.id)).not.toBeNull()
    expect((await detail(session.cookie, threadId)).messages).toHaveLength(0)
  })

  it('takes over a stale lock older than the TTL', async () => {
    const { session, threadId } = await setup()
    await sql`UPDATE app_user SET generation_started_at = now() - interval '11 minutes'`.execute(
      ctx.db
    )
    const { res } = await ask(session.cookie, threadId, 'hello')
    expect(res.status).toBe(200)
    expect(await lockOf(session.user.id)).toBeNull()
  })

  it('answers 409 thread_full at 24 non-failed messages', async () => {
    const { session, threadId } = await setup()
    await insertMessages(session.user.id, threadId, pairs(12, 'complete'))
    const { res } = await ask(session.cookie, threadId, 'one too many')
    expect(res.status).toBe(409)
    expectContract(res, 'post', '/api/thread/{id}/message')
    expect((res.body as ErrorBody).error.code).toBe('thread_full')
    expect(await lockOf(session.user.id)).toBeNull()
  })

  it('allows a question at 22 non-failed messages plus 2 failed ones', async () => {
    const { session, threadId } = await setup()
    await insertMessages(session.user.id, threadId, [
      ...pairs(11, 'complete'),
      ...pairs(1, 'failed')
    ])
    const { res } = await ask(session.cookie, threadId, 'still fits')
    expect(res.status).toBe(200)
    expect((await detail(session.cookie, threadId)).thread.messageCount).toBe(24)
  })

  it('blocks a second concurrent question while the first is streaming', async () => {
    const { session, threadId } = await setup()
    const stream = await openSlowStream(session.cookie, threadId, session.user.id)
    try {
      const { res } = await ask(session.cookie, threadId, 'second')
      expect(res.status).toBe(409)
      expect((res.body as ErrorBody).error.code).toBe('generation_in_progress')
    } finally {
      await stream.close()
    }
  })
})

describe('failure outcomes (AC10)', () => {
  it('[fake:error]: error event ai_provider_error, both messages failed, lock released', async () => {
    const { session, threadId } = await setup()
    const { res, events } = await ask(session.cookie, threadId, 'boom [fake:error]')
    expect(res.status).toBe(200)
    expect(events.map((event) => event.event)).toEqual(['message.start', 'error'])
    const error = events[1]?.data as ErrorBody
    expectSchema(error, 'ErrorResponse')
    expect(error.error.code).toBe('ai_provider_error')
    expect(error.requestId).toBe(res.headers['x-request-id'])
    const { messages, thread } = await detail(session.cookie, threadId)
    expect(messages.map((m) => [m.role, m.status, m.stopReason, m.content === ''])).toEqual([
      ['user', 'failed', null, false],
      ['assistant', 'failed', 'error', true]
    ])
    expect(thread.messageCount).toBe(0)
    expect(await lockOf(session.user.id)).toBeNull()
    const [call] = await aiCalls(session.user.id)
    expect(call).toMatchObject({
      kind: 'explain',
      stop_reason: 'error',
      input_token: 0,
      output_token: 0
    })
  })

  it('[fake:error-mid]: some deltas, then the error event and failed messages', async () => {
    const { session, threadId } = await setup()
    const { events } = await ask(session.cookie, threadId, 'boom [fake:error-mid]')
    expect(events.map((event) => event.event)).toEqual(['message.start', 'delta', 'delta', 'error'])
    expect((events[3]?.data as ErrorBody).error.code).toBe('ai_provider_error')
    const { messages } = await detail(session.cookie, threadId)
    expect(messages.map((m) => m.status)).toEqual(['failed', 'failed'])
    expect(messages[1]?.content).toBe('')
    expect(await lockOf(session.user.id)).toBeNull()
  })

  it('[fake:refuse]: error event ai_refused, empty failed assistant message, category recorded', async () => {
    const { session, threadId } = await setup()
    const { events } = await ask(session.cookie, threadId, 'no [fake:refuse]')
    const error = events.at(-1)
    expect(error?.event).toBe('error')
    expectSchema(error?.data, 'ErrorResponse')
    expect((error?.data as ErrorBody).error.code).toBe('ai_refused')
    const { messages } = await detail(session.cookie, threadId)
    expect(messages.map((m) => [m.role, m.status, m.stopReason, m.content === ''])).toEqual([
      ['user', 'failed', null, false],
      ['assistant', 'failed', 'refusal', true]
    ])
    expect(await lockOf(session.user.id)).toBeNull()
    const [call] = await aiCalls(session.user.id)
    expect(call).toMatchObject({ stop_reason: 'refusal', refusal_category: 'cyber' })
    expect(call?.output_token).toBeGreaterThan(0)
  })

  it('[fake:max_tokens]: message.complete with status incomplete, text kept', async () => {
    const { session, threadId } = await setup()
    const { events } = await ask(session.cookie, threadId, 'long [fake:max_tokens]')
    const complete = events.at(-1)
    expect(complete?.event).toBe('message.complete')
    expectSchema(complete?.data, 'StreamMessageComplete')
    expect(complete?.data).toMatchObject({ status: 'incomplete', stopReason: 'max_tokens' })
    const { messages } = await detail(session.cookie, threadId)
    expect(messages.map((m) => [m.status, m.stopReason])).toEqual([
      ['complete', null],
      ['incomplete', 'max_tokens']
    ])
    expect(messages[1]?.content).not.toBe('')
    expect(await lockOf(session.user.id)).toBeNull()
  })

  it('a retry after a failure succeeds and the failed turn is absent from the history', async () => {
    const { session, threadId } = await setup()
    await ask(session.cookie, threadId, 'boom [fake:error]')
    const retry = await ask(session.cookie, threadId, 'try again')
    expect(retry.res.status).toBe(200)
    expect(retry.events.at(-1)?.event).toBe('message.complete')
    expect(ctx.tutor.calls[1]?.history).toEqual([])
    const { messages, thread } = await detail(session.cookie, threadId)
    expect(messages).toHaveLength(4)
    expect(thread.messageCount).toBe(2)
  })

  it('keeps an incomplete answer in the history of the next question', async () => {
    const { session, threadId } = await setup()
    await ask(session.cookie, threadId, 'long [fake:max_tokens]')
    await ask(session.cookie, threadId, 'continue')
    const history = ctx.tutor.calls[1]?.history ?? []
    expect(history.map((turn) => turn.role)).toEqual(['user', 'assistant'])
    expect(history[1]?.content).not.toBe('')
  })

  it('records an ai_call row with tokens and stop reason for a successful turn', async () => {
    const { session, threadId } = await setup()
    await ask(session.cookie, threadId, 'hello')
    const calls = await aiCalls(session.user.id)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      kind: 'explain',
      model: 'fake',
      stop_reason: 'end_turn',
      refusal_category: null,
      cache_read_token: 0,
      cache_creation_token: 0
    })
    expect(calls[0]?.input_token).toBeGreaterThan(0)
    expect(calls[0]?.output_token).toBeGreaterThan(0)
  })
})

describe('client disconnect', () => {
  it('persists the partial answer as incomplete/aborted, releases the lock and records the call', async () => {
    const { session, threadId } = await setup()
    const stream = await openSlowStream(session.cookie, threadId, session.user.id)
    try {
      await stream.abortOnly()
      await waitSettled(session.user.id)
      const message = await ctx.db
        .selectFrom('message')
        .select(['status', 'stop_reason', 'content'])
        .where('thread_id', '=', threadId)
        .where('role', '=', 'assistant')
        .executeTakeFirstOrThrow()
      expect(message).toMatchObject({ status: 'incomplete', stop_reason: 'aborted' })
      expect(message.content).not.toBe('')
      const { messages } = await detail(session.cookie, threadId)
      expect(messages[0]?.status).toBe('complete')
      expect(await lockOf(session.user.id)).toBeNull()
      expect(await aiCalls(session.user.id)).toMatchObject([{ stop_reason: 'aborted' }])
    } finally {
      await stream.close()
    }
  })
})

describe('persistence failure', () => {
  it('marks the turn failed, keeps the ai_call and releases the lock when persisting the outcome fails', async () => {
    const { session, threadId } = await setup()
    // Break only the success write: the failure fallback (status failed) still goes through.
    await sql`
      CREATE FUNCTION fail_complete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced persistence failure'; END $$`.execute(ctx.db)
    await sql`
      CREATE TRIGGER fail_complete BEFORE UPDATE ON message
      FOR EACH ROW WHEN (NEW.status = 'complete' AND NEW.role = 'assistant')
      EXECUTE FUNCTION fail_complete()`.execute(ctx.db)
    try {
      const { res, events } = await ask(session.cookie, threadId, 'hello')
      expect(res.status).toBe(200)
      expect(events.at(-1)?.event).toBe('error')
      expect((events.at(-1)?.data as ErrorBody).error.code).toBe('internal_error')
    } finally {
      await sql`DROP TRIGGER fail_complete ON message`.execute(ctx.db)
      await sql`DROP FUNCTION fail_complete()`.execute(ctx.db)
    }
    const { messages } = await detail(session.cookie, threadId)
    expect(messages.map((m) => [m.role, m.status, m.stopReason])).toEqual([
      ['user', 'failed', 'error'],
      ['assistant', 'failed', 'error']
    ])
    expect(await lockOf(session.user.id)).toBeNull()
    expect(await aiCalls(session.user.id)).toMatchObject([{ stop_reason: 'end_turn' }])
  })
})

describe('validation and gates (AC11)', () => {
  it.each([
    ['empty', ''],
    ['whitespace-only', '  \n\t '],
    ['20,001 characters', 'x'.repeat(20_001)]
  ])('rejects a %s question with 400 validation_failed and details', async (_label, content) => {
    const { session, threadId } = await setup()
    const { res } = await ask(session.cookie, threadId, content)
    expect(res.status).toBe(400)
    expectContract(res, 'post', '/api/thread/{id}/message')
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('validation_failed')
    expect(body.error.details).toBeDefined()
    expect((await detail(session.cookie, threadId)).messages).toHaveLength(0)
    expect(await lockOf(session.user.id)).toBeNull()
  })

  it('accepts exactly 20,000 characters', async () => {
    const { session, threadId } = await setup()
    const { res } = await ask(session.cookie, threadId, 'x'.repeat(20_000))
    expect(res.status).toBe(200)
  })

  it('answers 413 for a body over the size limit', async () => {
    const { session, threadId } = await setup()
    const { res } = await ask(session.cookie, threadId, 'x'.repeat(300_000))
    expect(res.status).toBe(413)
    expectContract(res, 'post', '/api/thread/{id}/message')
  })

  it('answers 401 without a session and 403 for a foreign Origin', async () => {
    const { session, threadId } = await setup()
    const anon = await client.post(`/api/thread/${threadId}/message`).send({ content: 'hi' })
    expect(anon.status).toBe(401)
    expectContract(anon, 'post', '/api/thread/{id}/message')
    const foreign = await client
      .post(`/api/thread/${threadId}/message`)
      .set('Cookie', session.cookie)
      .set('Origin', 'https://evil.example')
      .send({ content: 'hi' })
    expect(foreign.status).toBe(403)
    expectContract(foreign, 'post', '/api/thread/{id}/message')
  })

  it('answers 503 ai_unavailable as JSON when AI_ENABLED=false, and leaves nothing behind', async () => {
    const off = createTestApp({ config: { aiEnabled: false } })
    try {
      const offClient = createClient(off.app, off.config)
      const { cookie, user } = await signUp(offClient)
      const thread = (await offClient.post('/api/thread').set('Cookie', cookie).send({})).body as {
        thread: ThreadBody
      }
      const res = await offClient
        .post(`/api/thread/${thread.thread.id}/message`)
        .set('Cookie', cookie)
        .send({ content: 'hello' })
      expect(res.status).toBe(503)
      expect(res.headers['content-type']).toMatch(/application\/json/)
      expectContract(res, 'post', '/api/thread/{id}/message')
      expect((res.body as ErrorBody).error.code).toBe('ai_unavailable')
      expect(off.tutor.calls).toHaveLength(0)
      expect(await lockOf(user.id)).toBeNull()
    } finally {
      await off.close()
    }
  })

  it('answers 404 for another user thread, and for an unknown one, without a lock or rows', async () => {
    const a = await signUp(client)
    const b = await signUp(client)
    const thread = await newThread(a.cookie)
    const foreign = await ask(b.cookie, thread.id, 'hello')
    expect(foreign.res.status).toBe(404)
    expectContract(foreign.res, 'post', '/api/thread/{id}/message')
    expect((foreign.res.body as ErrorBody).error.code).toBe('not_found')
    const unknown = await ask(b.cookie, 'does-not-exist', 'hello')
    expect(unknown.res.status).toBe(404)
    expect(await lockOf(b.user.id)).toBeNull()
    expect((await detail(a.cookie, thread.id)).messages).toHaveLength(0)
  })
})

describe('AI switch order', () => {
  it('answers 503 ai_unavailable, not 400, for an invalid body when AI_ENABLED=false', async () => {
    const off = createTestApp({ config: { aiEnabled: false } })
    try {
      const offClient = createClient(off.app, off.config)
      const { cookie } = await signUp(offClient)
      const thread = (await offClient.post('/api/thread').set('Cookie', cookie).send({})).body as {
        thread: ThreadBody
      }
      const res = await offClient
        .post(`/api/thread/${thread.thread.id}/message`)
        .set('Cookie', cookie)
        .send({ content: 42 })
      expect(res.status).toBe(503)
      expectContract(res, 'post', '/api/thread/{id}/message')
      expect((res.body as ErrorBody).error.code).toBe('ai_unavailable')
    } finally {
      await off.close()
    }
  })
})

describe('recovery of turns left in flight (I2)', () => {
  /** A crashed generation: user message plus an `incomplete` placeholder with no stop reason. */
  async function insertOrphanTurn(userId: string, threadId: string, ageMinutes: number) {
    const created = new Date(Date.now() - ageMinutes * 60 * 1000)
    await ctx.db
      .insertInto('message')
      .values({
        thread_id: threadId,
        user_id: userId,
        role: 'user',
        content: 'orphaned question',
        status: 'complete',
        stop_reason: null,
        created_at: created
      })
      .execute()
    await ctx.db
      .insertInto('message')
      .values({
        thread_id: threadId,
        user_id: userId,
        role: 'assistant',
        content: '',
        status: 'incomplete',
        stop_reason: null,
        created_at: created
      })
      .execute()
    await sql`UPDATE app_user SET generation_started_at = ${created} WHERE id = ${userId}`.execute(
      ctx.db
    )
  }

  it('marks a placeholder older than the lock TTL failed with its question on the next ask', async () => {
    const { session, threadId } = await setup()
    await insertOrphanTurn(session.user.id, threadId, 11)
    const { res } = await ask(session.cookie, threadId, 'a fresh question')
    expect(res.status).toBe(200)
    const { messages, thread } = await detail(session.cookie, threadId)
    expect(messages.map((m) => [m.role, m.status, m.stopReason])).toEqual([
      ['user', 'failed', null],
      ['assistant', 'failed', 'error'],
      ['user', 'complete', null],
      ['assistant', 'complete', 'end_turn']
    ])
    expect(thread.messageCount).toBe(2)
    expect(await lockOf(session.user.id)).toBeNull()
  })

  it('recovers it when the thread is read, and frees the thread from the cap', async () => {
    const { session, threadId } = await setup()
    await insertMessages(session.user.id, threadId, pairs(11, 'complete'))
    await insertOrphanTurn(session.user.id, threadId, 11)
    const { messages, thread } = await detail(session.cookie, threadId)
    // The orphan is backdated, so it sorts first.
    expect(messages.slice(0, 2).map((m) => [m.status, m.stopReason])).toEqual([
      ['failed', null],
      ['failed', 'error']
    ])
    expect(thread.messageCount).toBe(22)
  })

  it('leaves a placeholder younger than the lock TTL alone', async () => {
    const { session, threadId } = await setup()
    await insertOrphanTurn(session.user.id, threadId, 5)
    const { messages } = await detail(session.cookie, threadId)
    expect(messages.at(-1)).toMatchObject({ status: 'incomplete', stopReason: null })
    const { res } = await ask(session.cookie, threadId, 'too soon')
    expect(res.status).toBe(409)
    expect((res.body as ErrorBody).error.code).toBe('generation_in_progress')
  })

  it('recovers only the requesting user turns, and the boot sweep recovers the rest', async () => {
    const a = await setup()
    const b = await setup()
    await insertOrphanTurn(a.session.user.id, a.threadId, 11)
    await insertOrphanTurn(b.session.user.id, b.threadId, 11)
    await detail(a.session.cookie, a.threadId)
    const row = await ctx.db
      .selectFrom('message')
      .select('status')
      .where('thread_id', '=', b.threadId)
      .where('role', '=', 'assistant')
      .executeTakeFirstOrThrow()
    expect(row.status).toBe('incomplete')
    expect(await recoverStaleTurn(ctx.db)).toBe(1)
  })

  it('shutdown aborts a running generation; it persists aborted and releases the lock once', async () => {
    const own = createTestApp()
    const { session, threadId } = await setup()
    const stream = await openSlowStream(session.cookie, threadId, session.user.id, own.app)
    try {
      expect(own.inFlight.size).toBe(1)
      expect(own.inFlight.abortAll()).toBe(1)
      await waitSettled(session.user.id)
      const message = await ctx.db
        .selectFrom('message')
        .select(['status', 'stop_reason'])
        .where('thread_id', '=', threadId)
        .where('role', '=', 'assistant')
        .executeTakeFirstOrThrow()
      expect(message).toMatchObject({ status: 'incomplete', stop_reason: 'aborted' })
      expect(await lockOf(session.user.id)).toBeNull()
      expect(await aiCalls(session.user.id)).toHaveLength(1)
      expect(own.inFlight.size).toBe(0)
    } finally {
      await stream.close()
      await own.close()
    }
  })
})
