import type { Request, RequestHandler } from 'express'
import { ctxOf, type Limiters } from '../context.js'
import { consumeOrThrow, ipLimitKey, loginLimitKey } from '../lib/rate-limit.js'
import type { Middleware, ParamsDictionary } from './validate.js'

/** The client address; `trust proxy` (set from TRUST_PROXY) decides which hop it is. */
export function clientIp(req: Pick<Request, 'ip'>): string {
  return req.ip ?? 'unknown'
}

/**
 * Consumes one point of `limiter` per client IP (an IPv6 address counts per /64); on exhaustion
 * 429 `rate_limited` with `Retry-After`. The limiter is looked up per request, on the app's context.
 */
export function rateLimitByIp(limiter: keyof Limiters, message: string): Middleware {
  return async (req, res, next) => {
    await consumeOrThrow(ctxOf(req).limiters[limiter], ipLimitKey(clientIp(req)), res, message)
    next()
  }
}

/** Like `rateLimitByIp`, keyed on client IP + email; runs after the body is validated. */
export function rateLimitByIpAndEmail(
  limiter: keyof Limiters,
  message: string
): RequestHandler<ParamsDictionary, unknown, { email: string }> {
  return async (req, res, next) => {
    const key = loginLimitKey(clientIp(req), req.body.email)
    await consumeOrThrow(ctxOf(req).limiters[limiter], key, res, message)
    next()
  }
}
