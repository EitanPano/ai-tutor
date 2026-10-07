import { Router, type RequestHandler } from 'express'
import { pathParam } from '../../lib/validation.js'
import type { Db } from '../../lib/db/index.js'
import type { TutorProvider } from '../../lib/tutor/tutor.js'
import { createGuide, getGuide, updateStep } from './guide.service.js'
import { getAuth } from '../../http/get-auth.js'
import { pathId } from '../../http/path-id.js'
import type { AiApi } from '../ai/index.js'
import type { TopicApi } from '../topic/index.js'
import { updateStepSchema } from './guide.schema.js'

export function guideRouter(
  db: Db,
  requireSession: RequestHandler,
  tutor: TutorProvider,
  topic: TopicApi,
  ai: AiApi
): Router {
  const router = Router()

  router.post('/api/thread/:id/guide', requireSession, async (req, res) => {
    const guide = await createGuide(db, getAuth(req), { tutor, topic, ai }, pathId(req))
    res.status(201).json({ guide })
  })

  router.get('/api/guide/:id', requireSession, async (req, res) => {
    res.json({ guide: await getGuide(db, getAuth(req), pathId(req)) })
  })

  router.patch('/api/guide/:id/step/:stepId', requireSession, async (req, res) => {
    const input = updateStepSchema.parse(req.body)
    const stepId = pathParam(req.params.stepId)
    res.json({ step: await updateStep(db, getAuth(req), pathId(req), stepId, input) })
  })

  return router
}
