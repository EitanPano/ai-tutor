import { Router, type RequestHandler } from 'express'
import type { ThreadService } from './thread.service.js'
import { getAuth } from '../../middleware/auth.js'
import { pathId } from '../../http/path-id.js'
import { listQuerySchema, createSchema, updateSchema } from './thread.schema.js'

export function threadRouter(
  service: ThreadService,
  deps: { requireSession: RequestHandler }
): Router {
  const { requireSession } = deps
  const router = Router()

  router.get('/api/thread', requireSession, async (req, res) => {
    const query = listQuerySchema.parse(req.query)
    res.json(await service.list(getAuth(req), query))
  })

  router.post('/api/thread', requireSession, async (req, res) => {
    const input = createSchema.parse(req.body)
    res.status(201).json({ thread: await service.create(getAuth(req), input) })
  })

  router.get('/api/thread/:id', requireSession, async (req, res) => {
    res.json(await service.getDetail(getAuth(req), pathId(req)))
  })

  router.patch('/api/thread/:id', requireSession, async (req, res) => {
    const input = updateSchema.parse(req.body)
    res.json({ thread: await service.update(getAuth(req), pathId(req), input) })
  })

  router.delete('/api/thread/:id', requireSession, async (req, res) => {
    await service.delete(getAuth(req), pathId(req))
    res.status(204).end()
  })

  return router
}
