import type { Request } from 'express'

/** The `:id` path segment. Express types params loosely; a route with `:id` always has one. */
export function pathId(req: Request): string {
  const id: unknown = req.params.id
  return typeof id === 'string' ? id : ''
}
