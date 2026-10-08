import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp, signUpBody } from '../helper/client.js'
import { expectContract } from '../helper/contract.js'

const ctx = createTestApp()
const client = createClient(ctx.app, ctx.config)

beforeEach(() => truncateAll(ctx.db))
afterAll(() => ctx.close())

type ErrorBody = { error: { code: string } }

describe('NUL characters in text input', () => {
  it('rejects them in signup fields with 400 validation_failed, not 500', async () => {
    for (const field of ['displayName', 'password', 'timeZone'] as const) {
      const value = field === 'password' ? 'correct-horse\u0000battery' : `a\u0000b`
      const res = await client.post('/api/user').send(signUpBody({ [field]: value }))
      expect(res.status, field).toBe(400)
      expect((res.body as ErrorBody).error.code).toBe('validation_failed')
      expectContract(res, 'post', '/api/user')
    }
  })

  it('rejects them in a question and a thread title', async () => {
    const { cookie } = await signUp(client)
    const thread = await client.post('/api/thread').set('Cookie', cookie).send({ topicId: 'react' })
    const id = (thread.body as { thread: { id: string } }).thread.id

    const ask = await client
      .post(`/api/thread/${id}/message`)
      .set('Cookie', cookie)
      .send({ content: 'hello\u0000world' })
    expect(ask.status).toBe(400)
    expect((ask.body as ErrorBody).error.code).toBe('validation_failed')

    const rename = await client
      .patch(`/api/thread/${id}`)
      .set('Cookie', cookie)
      .send({ title: 'x\u0000y' })
    expect(rename.status).toBe(400)
    expect((rename.body as ErrorBody).error.code).toBe('validation_failed')
  })

  it('answers 404 for a path id holding a NUL', async () => {
    const { cookie } = await signUp(client)
    const res = await client.get('/api/thread/ab%00cd').set('Cookie', cookie)
    expect(res.status).toBe(404)
  })

  it('answers 404 for a NUL in any other thread, guide or quiz path id', async () => {
    const { cookie } = await signUp(client)
    const thread = await client.post('/api/thread').set('Cookie', cookie).send({ topicId: 'react' })
    const threadId = (thread.body as { thread: { id: string } }).thread.id
    const ask = await client
      .post(`/api/thread/${threadId}/message`)
      .set('Cookie', cookie)
      .send({ content: 'Why does useEffect run twice?' })
    expect(ask.status).toBe(200)
    const guide = await client.post(`/api/thread/${threadId}/guide`).set('Cookie', cookie)
    expect(guide.status).toBe(201)
    const guideId = (guide.body as { guide: { id: string } }).guide.id
    const quiz = await client.post('/api/quiz').set('Cookie', cookie).send({ threadId })
    expect(quiz.status).toBe(201)
    const quizId = (quiz.body as { quiz: { id: string } }).quiz.id

    // A child id is probed under a real parent, so the 404 comes from the NUL, not the parent.
    const calls = {
      'PATCH /api/thread/:id': () =>
        client.patch('/api/thread/ab%00cd').set('Cookie', cookie).send({ title: 'x' }),
      'DELETE /api/thread/:id': () => client.delete('/api/thread/ab%00cd').set('Cookie', cookie),
      'POST /api/thread/:id/message': () =>
        client.post('/api/thread/ab%00cd/message').set('Cookie', cookie).send({ content: 'hi' }),
      'POST /api/thread/:id/guide': () =>
        client.post('/api/thread/ab%00cd/guide').set('Cookie', cookie),
      'GET /api/guide/:id': () => client.get('/api/guide/ab%00cd').set('Cookie', cookie),
      'PATCH /api/guide/:id/step/:stepId': () =>
        client
          .patch(`/api/guide/${guideId}/step/ab%00cd`)
          .set('Cookie', cookie)
          .send({ done: true }),
      'GET /api/quiz/:id': () => client.get('/api/quiz/ab%00cd').set('Cookie', cookie),
      'POST /api/quiz/:id/attempt': () =>
        client.post('/api/quiz/ab%00cd/attempt').set('Cookie', cookie).send({ answers: [] }),
      'GET /api/quiz/:id/attempt/:attemptId': () =>
        client.get(`/api/quiz/${quizId}/attempt/ab%00cd`).set('Cookie', cookie)
    }
    for (const [route, call] of Object.entries(calls)) {
      const res = await call()
      expect(res.status, route).toBe(404)
      expect((res.body as ErrorBody).error.code, route).toBe('not_found')
    }
  })
})
