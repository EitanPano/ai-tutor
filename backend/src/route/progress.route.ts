import { Router } from 'express'
import type { Config } from '../lib/config.js'
import type { Db } from '../lib/db/index.js'
import { getProgress } from '../service/progress.service.js'
import { getAuth } from './middleware/get-auth.js'
import { requireSession } from './middleware/require-session.js'

export function progressRouter(db: Db, config: Config): Router {
  const router = Router()
  const session = requireSession(db, config)

  router.get('/api/progress', session, async (req, res) => {
    res.json(await getProgress(db, getAuth(req)))
  })

  return router
}
