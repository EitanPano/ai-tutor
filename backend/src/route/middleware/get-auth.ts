import type { Request } from 'express'
import type { Auth } from '../../service/ownership.js'
import { unauthorized } from '../../lib/error.js'

/** The signed-in user for this request. Routes pass this object to services explicitly. */
export function getAuth(req: Request): Auth {
  if (!req.auth) throw unauthorized('Sign in to continue.', 'unauthenticated')
  return { userId: req.auth.userId }
}
