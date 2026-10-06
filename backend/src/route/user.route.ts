import { Router } from 'express'
import { z } from 'zod'
import type { Config } from '../lib/config.js'
import { SESSION_COOKIE, sessionCookieOptions } from '../lib/cookie.js'
import type { Db } from '../lib/db/index.js'
import { createUser, updateUser } from '../service/user.service.js'
import { getAuth } from './middleware/get-auth.js'
import { requireSession } from './middleware/require-session.js'

// These schemas mirror SignupRequest / UpdateUserRequest in .orchestrate/api-contract.yaml.
const signupSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(80),
  timeZone: z.string().min(1).max(64)
})

const updateSchema = z
  .strictObject({
    displayName: z.string().min(1).max(80).optional(),
    timeZone: z.string().min(1).max(64).optional()
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field.' })

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
