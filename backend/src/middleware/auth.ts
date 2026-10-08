import type { Request } from 'express'
import type { Auth } from '../lib/ownership.js'
import { unauthenticated } from '../lib/error.js'

/** The signed-in user for this request. Routes pass this object to services explicitly. */
export function getAuth(req: Pick<Request, 'auth'>): Auth {
  if (!req.auth) throw unauthenticated()
  return { userId: req.auth.userId }
}
