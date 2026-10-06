import { Router } from 'express'
import { z } from 'zod'
import type { Config } from '../lib/config.js'
import type { Db } from '../lib/db/index.js'
import {
  createThread,
  deleteThread,
  getThreadDetail,
  listThreads,
  updateThread
} from '../service/thread.service.js'
import { getAuth } from './middleware/get-auth.js'
import { pathId } from './middleware/path-id.js'
import { requireSession } from './middleware/require-session.js'

// These schemas mirror ListThreads / CreateThreadRequest / UpdateThreadRequest in
// .orchestrate/api-contract.yaml.
const listQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
})

const createSchema = z.strictObject({
  topicId: z.string().min(1).optional(),
  title: z.string().min(1).max(120).optional()
})

const updateSchema = z
  .strictObject({
    title: z.string().min(1).max(120).optional(),
    topicId: z.string().min(1).optional()
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field.' })

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
