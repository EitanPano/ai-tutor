import { Router, type RequestHandler } from 'express'
import type { ProgressService } from './progress.service.js'
import { getAuth } from '../../http/get-auth.js'

export function progressRouter(
  service: ProgressService,
  deps: { requireSession: RequestHandler }
): Router {
  const router = Router()

  router.get('/api/progress', deps.requireSession, async (req, res) => {
    res.json(await service.get(getAuth(req)))
  })

  return router
}
