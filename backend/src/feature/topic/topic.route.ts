import { Router } from 'express'
import type { TopicService } from './topic.service.js'

export function topicRouter(service: TopicService): Router {
  const router = Router()

  router.get('/api/topic', async (_req, res) => {
    res.json({ topics: await service.list() })
  })

  return router
}
