import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'
import { isDbUnavailableError } from '../lib/db/unavailable.js'
import { AppError, ERROR_MESSAGE, notFound, type Details } from '../lib/error.js'

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound())
}

/** The response to one kind of error, and the line logged before it is sent, if any. */
type ErrorReply = {
  status: number
  code: string
  message: string
  details?: Details
  log?: { level: 'warn' | 'error'; message: string }
}

/** The reply to an error it recognises, or `undefined` to let the next matcher try. */
type ErrorMatcher = (err: unknown) => ErrorReply | undefined

type BodyParserError = { type?: unknown; status?: unknown; expose?: unknown }

function appErrorReply(err: unknown): ErrorReply | undefined {
  if (!(err instanceof AppError)) return undefined
  return { status: err.status, code: err.code, message: err.message, details: err.details }
}

function zodErrorReply(err: unknown): ErrorReply | undefined {
  if (!(err instanceof ZodError)) return undefined
  const issues = err.issues.map((issue) => ({ path: issue.path, message: issue.message }))
  return {
    status: 400,
    code: 'validation_failed',
    message: ERROR_MESSAGE.validation_failed,
    details: { issues }
  }
}

/** body-parser errors with a code of their own, by the `type` body-parser tags them with. */
const BODY_PARSER_ERROR_BY_TYPE = new Map<string, ErrorMatcher>([
  [
    'entity.parse.failed',
    // body-parser raises a JSON parse failure as the SyntaxError that JSON.parse threw.
    (err) =>
      err instanceof SyntaxError
        ? { status: 400, code: 'malformed_json', message: 'The request body is not valid JSON.' }
        : undefined
  ],
  [
    'entity.too.large',
    () => ({ status: 413, code: 'payload_too_large', message: 'The request body is too large.' })
  ]
])

const CLIENT_ERROR_LOG = { level: 'warn', message: 'client error' } as const

// The replies to an exposed body-parser 4xx with no `type` entry above: 415 has a code of its own,
// any other 4xx is a bad request.

/** An exposed body-parser 415 (unsupported charset or content encoding). */
const UNSUPPORTED_MEDIA_TYPE = {
  code: 'unsupported_media_type',
  message: 'The request content type or encoding is not supported.'
}
/** Any other exposed body-parser 4xx (e.g. 400 aborted or size mismatch). */
const BAD_REQUEST = { code: 'bad_request', message: 'The request could not be processed.' }

function bodyParserReply(err: unknown): ErrorReply | undefined {
  const parserError = err as BodyParserError | null
  const type = parserError?.type
  const byType = typeof type === 'string' ? BODY_PARSER_ERROR_BY_TYPE.get(type)?.(err) : undefined
  if (byType) return byType
  // Other body-parser client errors (415 charset/encoding, 400 aborted/size mismatch) carry a
  // 4xx status with expose: true. Map them by status instead of letting them become 500s.
  const status = parserError?.status
  if (
    err instanceof Error &&
    parserError?.expose === true &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500
  ) {
    const { code, message } = status === 415 ? UNSUPPORTED_MEDIA_TYPE : BAD_REQUEST
    return { status, code, message, log: CLIENT_ERROR_LOG }
  }
  return undefined
}

function dbUnavailableReply(err: unknown): ErrorReply | undefined {
  if (!isDbUnavailableError(err)) return undefined
  return {
    status: 503,
    code: 'db_unavailable',
    message: ERROR_MESSAGE.db_unavailable,
    log: { level: 'error', message: 'database unavailable' }
  }
}

/** Tried in order; the first reply wins. An error none of them recognises is `INTERNAL_ERROR`. */
const ERROR_MATCHERS: readonly ErrorMatcher[] = [
  appErrorReply,
  zodErrorReply,
  bodyParserReply,
  dbUnavailableReply
]

const INTERNAL_ERROR: ErrorReply = {
  status: 500,
  code: 'internal_error',
  message: ERROR_MESSAGE.internal_error,
  log: { level: 'error', message: 'unhandled error' }
}

function replyTo(err: unknown): ErrorReply {
  for (const match of ERROR_MATCHERS) {
    const reply = match(err)
    if (reply) return reply
  }
  return INTERNAL_ERROR
}

function requestIdOf(locals: Record<string, unknown>): string {
  const id = locals.requestId
  return typeof id === 'string' ? id : 'unknown'
}

export const errorMiddleware: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    next(err)
    return
  }
  const requestId = requestIdOf(res.locals)
  const { status, code, message, details, log } = replyTo(err)
  if (log) req.log[log.level]({ err, requestId }, log.message)
  res.status(status).json({
    error: { code, message, ...(details ? { details } : {}) },
    requestId
  })
}
