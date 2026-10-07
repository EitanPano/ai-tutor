import { Router } from 'express'
import type { Config } from '../../lib/config.js'
import type { Db } from '../../lib/db/index.js'
import {
  createThread,
  deleteThread,
  getThreadDetail,
  listThreads,
  updateThread
} from './thread.service.js'
import { getAuth } from '../../http/get-auth.js'
import { pathId } from '../../http/path-id.js'
import { requireSession } from '../user/index.js'
import { listQuerySchema, createSchema, updateSchema } from './thread.schema.js'

export function threadRouter(db: Db, config: Config): Router {
  const router = Router()
  const session = requireSession(db, config)

  router.get('/api/thread', session, async (req, res) => {
    const query = listQuerySchema.parse(req.query)
    res.json(await listThreads(db, getAuth(req), query))
  })

  router.post('/api/thread', session, async (req, res) => {
    const input = createSchema.parse(req.body)
    res.status(201).json({ thread: await createThread(db, getAuth(req), input) })
  })

  router.get('/api/thread/:id', session, async (req, res) => {
    res.json(await getThreadDetail(db, getAuth(req), pathId(req)))
  })

  router.patch('/api/thread/:id', session, async (req, res) => {
    const input = updateSchema.parse(req.body)
    res.json({ thread: await updateThread(db, getAuth(req), pathId(req), input) })
  })

  router.delete('/api/thread/:id', session, async (req, res) => {
    await deleteThread(db, getAuth(req), pathId(req))
    res.status(204).end()
  })

  return router
}
