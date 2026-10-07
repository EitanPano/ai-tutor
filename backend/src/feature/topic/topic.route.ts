import { Router } from 'express'
import type { Db } from '../../lib/db/index.js'
import { listTopics } from './topic.service.js'

export function topicRouter(db: Db): Router {
  const router = Router()

  router.get('/api/topic', async (_req, res) => {
    res.json({ topics: await listTopics(db) })
  })

  return router
}
