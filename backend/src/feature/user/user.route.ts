import { Router } from 'express'
import type { Config } from '../../lib/config.js'
import { SESSION_COOKIE, sessionCookieOptions } from '../../lib/cookie.js'
import type { Db } from '../../lib/db/index.js'
import { createUser, updateUser } from './user.service.js'
import { getAuth } from '../../http/get-auth.js'
import { requireSession } from './require-session.js'
import { signupSchema, updateSchema } from './user.schema.js'

export function userRouter(db: Db, config: Config): Router {
  const router = Router()

  router.post('/api/user', async (req, res) => {
    const input = signupSchema.parse(req.body)
    const { user, token } = await createUser(db, input)
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(config))
    res.status(201).json({ user })
  })

  router.patch('/api/user', requireSession(db, config), async (req, res) => {
    const input = updateSchema.parse(req.body)
    const user = await updateUser(db, getAuth(req), input)
    res.json({ user })
  })

  return router
}
