import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'

type Details = Record<string, unknown>

export class AppError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: Details

  constructor(status: number, code: string, message: string, details?: Details) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    if (details !== undefined) this.details = details
  }
}

export const badRequest = (code: string, message: string, details?: Details) =>
  new AppError(400, code, message, details)
export const unauthorized = (message = 'Sign in to continue.', code = 'unauthorized') =>
  new AppError(401, code, message)
export const forbidden = (message = 'This request is not allowed.', code = 'forbidden') =>
  new AppError(403, code, message)
export const notFound = (message = 'Not found.', code = 'not_found') =>
  new AppError(404, code, message)
export const conflict = (code: string, message: string, details?: Details) =>
  new AppError(409, code, message, details)
export const unprocessable = (code: string, message: string, details?: Details) =>
  new AppError(422, code, message, details)
export const tooManyRequests = (
  message = 'Too many requests. Try again later.',
  details?: Details
) => new AppError(429, 'rate_limited', message, details)
export const badGateway = (code: string, message: string, details?: Details) =>
  new AppError(502, code, message, details)
export const serviceUnavailable = (code: string, message: string, details?: Details) =>
  new AppError(503, code, message, details)

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
  req.log.error({ err, requestId }, 'unhandled error')
  send(500, 'internal_error', 'Something went wrong on our side. Try again.')
}
