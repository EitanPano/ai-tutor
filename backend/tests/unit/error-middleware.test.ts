import express, { type Request, type Response } from 'express'
import { pino } from 'pino'
import { pinoHttp } from 'pino-http'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { markPoolConnectError } from '../../src/lib/db/unavailable.js'
import { AppError, ERROR_MESSAGE } from '../../src/lib/error.js'
import { errorMiddleware } from '../../src/middleware/error.js'
import { requestId } from '../../src/middleware/request-id.js'
import { http, stopServer } from '../helper/client.js'

type ErrorBody = { error: { code: string; message: string; details?: unknown }; requestId: string }
type LogLine = { level: number; msg: string; requestId?: string }

/** pino's numeric levels. */
const WARN = 40
const ERROR = 50
const REQUEST_ID = 'req-err'

const logged: LogLine[] = []
const logger = pino(
  { level: 'info' },
  {
    write: (line: string) => {
      logged.push(JSON.parse(line) as LogLine)
    }
  }
)

// The error middleware behind a request id, a recording logger and a 1 kB JSON parser. Each GET
// route throws one kind of error; POST /echo lets body-parser raise its own.
const app = express()
app.use(requestId)
app.use(pinoHttp({ logger, autoLogging: false }))
app.use(express.json({ limit: '1kb' }))
app.post('/echo', (_req, res) => {
  res.status(204).end()
})
app.get('/throw/app-error', () => {
  throw new AppError(409, 'thread_busy', 'Thread is busy.', { threadId: 't1' })
})
app.get('/throw/app-error-without-details', () => {
  throw new AppError(404, 'not_found', 'Not found.')
})
app.get('/throw/zod', () => {
  z.object({ email: z.email() }).parse({ email: 'nope' })
})
app.get('/throw/exposed-4xx', () => {
  // Shaped like the http-errors client errors body-parser raises.
  throw Object.assign(new Error('Unprocessable.'), { status: 422, expose: true })
})
app.get('/throw/db-down', () => {
  const err = new Error('timeout exceeded when trying to connect')
  markPoolConnectError(err)
  throw err
})
app.get('/throw/plain', () => {
  throw new Error('secret internal detail')
})
app.use(errorMiddleware)

beforeEach(() => {
  logged.length = 0
})

afterAll(async () => {
  await stopServer(app)
})

async function get(path: string) {
  const res = await http(app).get(path).set('X-Request-Id', REQUEST_ID)
  return { status: res.status, body: res.body as ErrorBody }
}

async function postJson(body: string, headers: Record<string, string> = {}) {
  const res = await http(app)
    .post('/echo')
    .set({ 'Content-Type': 'application/json', 'X-Request-Id': REQUEST_ID, ...headers })
    .send(body)
  return { status: res.status, body: res.body as ErrorBody }
}

describe('errorMiddleware', () => {
  it('maps an AppError to its status, code, message and details, unlogged', async () => {
    expect(await get('/throw/app-error')).toEqual({
      status: 409,
      body: {
        error: { code: 'thread_busy', message: 'Thread is busy.', details: { threadId: 't1' } },
        requestId: REQUEST_ID
      }
    })
    expect(logged).toEqual([])
  })

  it('leaves details out for an AppError without them', async () => {
    expect(await get('/throw/app-error-without-details')).toEqual({
      status: 404,
      body: { error: { code: 'not_found', message: 'Not found.' }, requestId: REQUEST_ID }
    })
    expect(logged).toEqual([])
  })

  it('maps a ZodError to 400 validation_failed with its issues, unlogged', async () => {
    const { status, body } = await get('/throw/zod')
    expect(status).toBe(400)
    expect(body).toEqual({
      error: {
        code: 'validation_failed',
        message: 'The request is invalid.',
        details: { issues: [{ path: ['email'], message: expect.any(String) as unknown }] }
      },
      requestId: REQUEST_ID
    })
    expect(logged).toEqual([])
  })

  it('maps malformed JSON to 400 malformed_json, unlogged', async () => {
    expect(await postJson('{"broken":')).toEqual({
      status: 400,
      body: {
        error: { code: 'malformed_json', message: 'The request body is not valid JSON.' },
        requestId: REQUEST_ID
      }
    })
    expect(logged).toEqual([])
  })

  it('maps a body over the limit to 413 payload_too_large, unlogged', async () => {
    expect(await postJson(JSON.stringify({ text: 'x'.repeat(2048) }))).toEqual({
      status: 413,
      body: {
        error: { code: 'payload_too_large', message: 'The request body is too large.' },
        requestId: REQUEST_ID
      }
    })
    expect(logged).toEqual([])
  })

  it('maps an exposed 415 to unsupported_media_type and logs a client error', async () => {
    expect(
      await postJson('{}', { 'Content-Type': 'application/json; charset=iso-8859-1' })
    ).toEqual({
      status: 415,
      body: {
        error: {
          code: 'unsupported_media_type',
          message: 'The request content type or encoding is not supported.'
        },
        requestId: REQUEST_ID
      }
    })
    expect(logged).toMatchObject([{ level: WARN, msg: 'client error', requestId: REQUEST_ID }])
  })

  it('keeps the status of another exposed 4xx as bad_request and logs a client error', async () => {
    expect(await get('/throw/exposed-4xx')).toEqual({
      status: 422,
      body: {
        error: { code: 'bad_request', message: 'The request could not be processed.' },
        requestId: REQUEST_ID
      }
    })
    expect(logged).toMatchObject([{ level: WARN, msg: 'client error', requestId: REQUEST_ID }])
  })

  it('maps a database connection failure to 503 db_unavailable and logs an error', async () => {
    expect(await get('/throw/db-down')).toEqual({
      status: 503,
      body: {
        error: { code: 'db_unavailable', message: ERROR_MESSAGE.db_unavailable },
        requestId: REQUEST_ID
      }
    })
    expect(logged).toMatchObject([
      { level: ERROR, msg: 'database unavailable', requestId: REQUEST_ID }
    ])
  })

  it('maps anything else to 500 internal_error without its message, and logs an error', async () => {
    expect(await get('/throw/plain')).toEqual({
      status: 500,
      body: {
        error: { code: 'internal_error', message: ERROR_MESSAGE.internal_error },
        requestId: REQUEST_ID
      }
    })
    expect(logged).toMatchObject([{ level: ERROR, msg: 'unhandled error', requestId: REQUEST_ID }])
  })

  it('hands the error to the next handler once the headers are sent', () => {
    const err = new Error('failed mid-stream')
    const res = { headersSent: true, status: vi.fn() }
    const next = vi.fn()
    void errorMiddleware(err, {} as Request, res as unknown as Response, next)
    expect(next).toHaveBeenCalledWith(err)
    expect(res.status).not.toHaveBeenCalled()
  })
})
