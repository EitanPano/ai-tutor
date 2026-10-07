import { Router, type RequestHandler } from 'express'
import type { AiApi } from '../ai/index.js'
import { pathParam } from '../../lib/validation.js'
import type { GuideService } from './guide.service.js'
import { getAuth } from '../../http/get-auth.js'
import { pathId } from '../../http/path-id.js'
import { updateStepSchema } from './guide.schema.js'

export function guideRouter(
  service: GuideService,
  { requireSession, ai }: { requireSession: RequestHandler; ai: AiApi }
): Router {
  const router = Router()

  router.post('/api/thread/:id/guide', requireSession, async (req, res) => {
    // The AI switch is the first check, before the request is looked at (same as the quiz and ask).
    ai.assertEnabled()
    const guide = await service.create(getAuth(req), pathId(req))
    res.status(201).json({ guide })
  })

  router.get('/api/guide/:id', requireSession, async (req, res) => {
    res.json({ guide: await service.get(getAuth(req), pathId(req)) })
  })

  router.patch('/api/guide/:id/step/:stepId', requireSession, async (req, res) => {
    const input = updateStepSchema.parse(req.body)
    const stepId = pathParam(req.params.stepId)
    res.json({ step: await service.updateStep(getAuth(req), pathId(req), stepId, input) })
  })

  return router
}
