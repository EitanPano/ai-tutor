import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'
import { isDbUnavailableError } from '../lib/db/unavailable.js'
import { AppError, ERROR_MESSAGE, notFound } from '../lib/error.js'

type Details = Record<string, unknown>

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound())
}

type BodyParserError = { type?: unknown; status?: unknown; expose?: unknown }

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
  const send = (status: number, code: string, message: string, details?: Details) => {
    res.status(status).json({
      error: { code, message, ...(details ? { details } : {}) },
      requestId
    })
  }

  if (err instanceof AppError) {
    send(err.status, err.code, err.message, err.details)
    return
  }
  if (err instanceof ZodError) {
    const issues = err.issues.map((issue) => ({ path: issue.path, message: issue.message }))
    send(400, 'validation_failed', 'The request is invalid.', { issues })
    return
  }
  const parserError = err as BodyParserError | null
  const bodyType = parserError?.type
  if (err instanceof SyntaxError && bodyType === 'entity.parse.failed') {
    send(400, 'malformed_json', 'The request body is not valid JSON.')
    return
  }
  if (bodyType === 'entity.too.large') {
    send(413, 'payload_too_large', 'The request body is too large.')
    return
  }
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
    req.log.warn({ err, requestId }, 'client error')
    if (status === 415) {
      send(415, 'unsupported_media_type', 'The request content type or encoding is not supported.')
    } else {
      send(status, 'bad_request', 'The request could not be processed.')
    }
    return
  }
  if (isDbUnavailableError(err)) {
    req.log.error({ err, requestId }, 'database unavailable')
    send(503, 'db_unavailable', ERROR_MESSAGE.db_unavailable)
    return
  }
  req.log.error({ err, requestId }, 'unhandled error')
  send(500, 'internal_error', ERROR_MESSAGE.internal_error)
}
