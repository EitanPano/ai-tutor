import { Router, type RequestHandler } from 'express'
import type { Db } from '../../lib/db/index.js'
import { getProgress } from './progress.service.js'
import { getAuth } from '../../http/get-auth.js'

export function progressRouter(db: Db, requireSession: RequestHandler): Router {
  const router = Router()

  router.get('/api/progress', requireSession, async (req, res) => {
    res.json(await getProgress(db, getAuth(req)))
  })

  return router
}
