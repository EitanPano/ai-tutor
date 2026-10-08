import type { RequestHandler } from 'express'
import { forbidden } from '../lib/error.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF defence: a state-changing request must carry an Origin header exactly equal to the
 * frontend origin. Browsers always send Origin on cross-site POST/PUT/PATCH/DELETE.
 */
export function originCheck(frontendUrl: string): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method) || req.get('origin') === frontendUrl) {
      next()
      return
    }
    next(forbidden('This request came from an origin that is not allowed.', 'forbidden_origin'))
  }
}
