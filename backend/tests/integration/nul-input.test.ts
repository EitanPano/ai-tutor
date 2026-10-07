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
})
