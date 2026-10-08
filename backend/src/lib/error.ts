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

/** The one wording of each error the API sends from more than one place, keyed by its code. */
export const ERROR_MESSAGE = {
  internal_error: 'Something went wrong on our side. Try again.',
  db_unavailable: 'The database is not reachable.',
  unauthenticated: 'Sign in to continue.',
  ai_provider_error: 'The AI service failed to answer. Retry in a moment.',
  ai_refused: "The tutor can't help with that question. Try rephrasing it.",
  ai_unavailable: 'AI features are temporarily unavailable.'
} as const

export const badRequest = (code: string, message: string, details?: Details) =>
  new AppError(400, code, message, details)
export const unauthorized = (
  message: string = ERROR_MESSAGE.unauthenticated,
  code = 'unauthorized'
) => new AppError(401, code, message)
/** 401 `unauthenticated`: the request carries no valid session. */
export const unauthenticated = () =>
  new AppError(401, 'unauthenticated', ERROR_MESSAGE.unauthenticated)
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
