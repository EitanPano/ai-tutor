import { z } from 'zod'
import { markPoolConnectError } from '../../src/lib/db/unavailable.js'
import { AppError } from '../../src/lib/error.js'
import { afterAll, describe, expect, it } from 'vitest'
import { createTestApp } from '../helper/app.js'
import { http } from '../helper/client.js'
import { expectContract, expectSchema } from '../helper/contract.js'

const ctx = createTestApp()
// Test-only routes that throw, to exercise every branch of the error middleware.
const errors = createTestApp({
  extraRoutes: (app) => {
    app.get('/boom/app', () => {
      throw new AppError(409, 'thread_busy', 'Thread is busy.', { threadId: 't1' })
    })
    app.get('/boom/zod', () => {
      z.object({ email: z.email() }).parse({ email: 'nope' })
    })
    app.get('/boom/db-down', () => {
      const err = new Error('timeout exceeded when trying to connect')
      markPoolConnectError(err)
      throw err
    })
    app.get('/boom/other-network', () => {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), { code: 'ECONNREFUSED' })
    })
    app.get('/boom/statement-timeout', () => {
      throw Object.assign(new Error('canceling statement due to statement timeout'), {
        code: '57014'
      })
    })
    app.get('/boom/plain', () => {
      throw new Error('secret internal detail')
    })
  }
})
const unreachable = createTestApp({
  databaseUrl: 'postgres://ai_tutor:ai_tutor@127.0.0.1:1/ai_tutor_test'
})

afterAll(async () => {
  await ctx.close()
  await unreachable.close()
  await errors.close()
})

describe('GET /health', () => {
  it('returns 200 ok', async () => {
    const res = await http(ctx.app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
    expectContract(res, 'get', '/health')
  })

  it('does not advertise the framework', async () => {
    const res = await http(ctx.app).get('/health')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})

describe('GET /ready', () => {
  it('returns 200 ready when the database is reachable', async () => {
    const res = await http(ctx.app).get('/ready')
    expect(res.status).toBe(200)
    expectContract(res, 'get', '/ready')
  })

  it('returns 503 db_unavailable when the database is unreachable', async () => {
    const res = await http(unreachable.app).get('/ready')
    expect(res.status).toBe(503)
    expect((res.body as { error: { code: string } }).error.code).toBe('db_unavailable')
    expectContract(res, 'get', '/ready')
  })
})

describe('error handling', () => {
  type ErrorBody = {
    error: { code: string; message: string; details?: unknown }
    requestId: string
  }

  it('returns the standard 404 shape with a requestId for unknown routes', async () => {
    const res = await http(ctx.app).get('/nope')
    expect(res.status).toBe(404)
    const body = res.body as ErrorBody
    expect(body.error).toEqual({ code: 'not_found', message: 'Not found.' })
    expect(body.requestId).toBe(res.headers['x-request-id'])
    expectSchema(body, 'ErrorResponse')
  })

  it('maps AppError to its status, code, message and details', async () => {
    const res = await http(errors.app).get('/boom/app').set('X-Request-Id', 'req-app')
    expect(res.status).toBe(409)
    expect(res.body).toEqual({
      error: { code: 'thread_busy', message: 'Thread is busy.', details: { threadId: 't1' } },
      requestId: 'req-app'
    })
    expectSchema(res.body, 'ErrorResponse')
  })

  it('maps ZodError to 400 validation_failed with issues', async () => {
    const res = await http(errors.app).get('/boom/zod').set('X-Request-Id', 'req-zod')
    expect(res.status).toBe(400)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('validation_failed')
    expect(body.error.message).toBe('The request is invalid.')
    expect(body.error.details).toEqual({
      issues: [{ path: ['email'], message: expect.any(String) as unknown }]
    })
    expect(body.requestId).toBe('req-zod')
    expectSchema(body, 'ErrorResponse')
  })

  it('maps unexpected errors to a generic 500 without leaking internals', async () => {
    const res = await http(errors.app).get('/boom/plain').set('X-Request-Id', 'req-500')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({
      error: { code: 'internal_error', message: 'Something went wrong on our side. Try again.' },
      requestId: 'req-500'
    })
    expect(res.text).not.toContain('secret internal detail')
    expect(res.text).not.toContain('stack')
    expect(res.text).not.toContain('.ts:')
    expectSchema(res.body, 'ErrorResponse')
  })

  it('maps a database connection failure to 503 db_unavailable', async () => {
    const res = await http(errors.app).get('/boom/db-down').set('X-Request-Id', 'req-db')
    expect(res.status).toBe(503)
    expect(res.body).toEqual({
      error: { code: 'db_unavailable', message: 'The database is not reachable.' },
      requestId: 'req-db'
    })
    expectSchema(res.body, 'ErrorResponse')
  })

  it('keeps a non-database network error as 500 internal_error', async () => {
    const res = await http(errors.app).get('/boom/other-network')
    expect(res.status).toBe(500)
    expect((res.body as ErrorBody).error.code).toBe('internal_error')
  })

  it('keeps a statement timeout as 500 internal_error', async () => {
    const res = await http(errors.app).get('/boom/statement-timeout')
    expect(res.status).toBe(500)
    expect((res.body as ErrorBody).error.code).toBe('internal_error')
  })

  it('returns 400 malformed_json for a broken JSON body', async () => {
    const res = await http(ctx.app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
    expect(res.status).toBe(400)
    const body = res.body as ErrorBody
    expect(body.error).toEqual({
      code: 'malformed_json',
      message: 'The request body is not valid JSON.'
    })
    expect(body.requestId).toBe(res.headers['x-request-id'])
    expectSchema(body, 'ErrorResponse')
  })

  it('returns 413 payload_too_large for an oversized body', async () => {
    const res = await http(ctx.app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ text: 'x'.repeat(300 * 1024) }))
    expect(res.status).toBe(413)
    const body = res.body as ErrorBody
    expect(body.error).toEqual({
      code: 'payload_too_large',
      message: 'The request body is too large.'
    })
    expect(body.requestId).toBe(res.headers['x-request-id'])
    expectSchema(body, 'ErrorResponse')
  })

  it('maps other body-parser client errors by status (415 for an unsupported charset)', async () => {
    const res = await http(ctx.app)
      .post('/health')
      .set('Content-Type', 'application/json; charset=iso-8859-1')
      .send('{}')
    expect(res.status).toBe(415)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('unsupported_media_type')
    expect(body.requestId).toBe(res.headers['x-request-id'])
    expectSchema(body, 'ErrorResponse')
  })

  it('maps a body that fails to decode to 400 bad_request', async () => {
    const res = await http(ctx.app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      .send('{}')
    expect(res.status).toBe(400)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('bad_request')
    expect(body.requestId).toBe(res.headers['x-request-id'])
    expectSchema(body, 'ErrorResponse')
  })

  it('maps an unsupported Content-Encoding to 415', async () => {
    const res = await http(ctx.app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'bogus')
      .send('{}')
    expect(res.status).toBe(415)
    expect((res.body as ErrorBody).error.code).toBe('unsupported_media_type')
  })
})

describe('request id', () => {
  it('echoes a sane incoming X-Request-Id', async () => {
    const res = await http(ctx.app).get('/health').set('X-Request-Id', 'abc-123')
    expect(res.headers['x-request-id']).toBe('abc-123')
  })

  it('replaces an unsafe X-Request-Id with a generated one', async () => {
    const res = await http(ctx.app).get('/health').set('X-Request-Id', 'bad id with spaces')
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })
})
