import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { createTestApp } from '../helper/app.js'
import { expectContract } from '../helper/contract.js'

const ctx = createTestApp()
const unreachable = createTestApp({
  databaseUrl: 'postgres://ai_tutor:ai_tutor@localhost:1/ai_tutor_test'
})

afterAll(async () => {
  await ctx.close()
  await unreachable.close()
})

describe('GET /health', () => {
  it('returns 200 ok', async () => {
    const res = await request(ctx.app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
    expectContract(res, 'get', '/health')
  })

  it('does not advertise the framework', async () => {
    const res = await request(ctx.app).get('/health')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})

describe('GET /ready', () => {
  it('returns 200 ready when the database is reachable', async () => {
    const res = await request(ctx.app).get('/ready')
    expect(res.status).toBe(200)
    expectContract(res, 'get', '/ready')
  })

  it('returns 503 db_unavailable when the database is unreachable', async () => {
    const res = await request(unreachable.app).get('/ready')
    expect(res.status).toBe(503)
    expect((res.body as { error: { code: string } }).error.code).toBe('db_unavailable')
    expectContract(res, 'get', '/ready')
  })
})

describe('error handling', () => {
  it('returns the standard 404 shape with a requestId for unknown routes', async () => {
    const res = await request(ctx.app).get('/nope')
    expect(res.status).toBe(404)
    const body = res.body as { error: { code: string; message: string }; requestId: string }
    expect(body.error.code).toBe('not_found')
    expect(body.requestId).toBe(res.headers['x-request-id'])
  })

  it('returns 400 malformed_json for a broken JSON body', async () => {
    const res = await request(ctx.app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
    expect(res.status).toBe(400)
    expect((res.body as { error: { code: string } }).error.code).toBe('malformed_json')
  })

  it('returns 413 payload_too_large for an oversized body', async () => {
    const res = await request(ctx.app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ text: 'x'.repeat(300 * 1024) }))
    expect(res.status).toBe(413)
    expect((res.body as { error: { code: string } }).error.code).toBe('payload_too_large')
  })
})

describe('request id', () => {
  it('echoes a sane incoming X-Request-Id', async () => {
    const res = await request(ctx.app).get('/health').set('X-Request-Id', 'abc-123')
    expect(res.headers['x-request-id']).toBe('abc-123')
  })

  it('replaces an unsafe X-Request-Id with a generated one', async () => {
    const res = await request(ctx.app).get('/health').set('X-Request-Id', 'bad id with spaces')
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })
})
