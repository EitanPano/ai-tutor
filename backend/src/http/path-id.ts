import type { Request } from 'express'
import { pathParam } from '../lib/validation.js'

/** The `:id` path segment. Express types params loosely; a route with `:id` always has one. */
export function pathId(req: Request): string {
  return pathParam(req.params.id)
}
