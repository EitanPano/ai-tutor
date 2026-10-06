import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp, signUpBody } from '../helper/client.js'
import { expectContract } from '../helper/contract.js'

const ctx = createTestApp()
const client = createClient(ctx.app, ctx.config)

type ErrorBody = { error: { code: string } }

beforeEach(() => truncateAll(ctx.db))
afterAll(() => ctx.close())

describe('origin check (AC12)', () => {
  it('rejects a state-changing request from a foreign Origin with 403 forbidden_origin', async () => {
    const res = await request(ctx.app)
      .post('/api/user')
      .set('Origin', 'https://evil.example')
      .send(signUpBody())
    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('forbidden_origin')
    expectContract(res, 'post', '/api/user')
  })

  it('rejects a state-changing request without an Origin header', async () => {
    const res = await request(ctx.app).post('/api/session').send({ email: 'a@b.co', password: 'x' })
    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('forbidden_origin')
    expectContract(res, 'post', '/api/session')
  })

  it('rejects an Origin that is not exactly the frontend origin', async () => {
    const res = await request(ctx.app)
      .post('/api/session')
      .set('Origin', `${ctx.config.frontendUrl}/`)
      .send({ email: 'a@b.co', password: 'x' })
    expect(res.status).toBe(403)
  })

  it('blocks DELETE and PATCH from a foreign Origin even with a valid cookie', async () => {
    const { cookie } = await signUp(client)
    const del = await request(ctx.app)
      .delete('/api/session')
      .set('Origin', 'https://evil.example')
      .set('Cookie', cookie)
    expect(del.status).toBe(403)
    expectContract(del, 'delete', '/api/session')
    const patch = await request(ctx.app)
      .patch('/api/user')
      .set('Origin', 'https://evil.example')
      .set('Cookie', cookie)
      .send({ displayName: 'x' })
    expect(patch.status).toBe(403)
    expectContract(patch, 'patch', '/api/user')
    expect((await client.get('/api/session').set('Cookie', cookie)).status).toBe(200)
  })

  it('lets a GET without an Origin header through', async () => {
    const { cookie } = await signUp(client)
    const res = await request(ctx.app).get('/api/session').set('Cookie', cookie)
    expect(res.status).toBe(200)
  })
})
