import { Router } from 'express'
import { pathParam } from '../../lib/validation.js'
import type { Config } from '../../lib/config.js'
import type { Db } from '../../lib/db/index.js'
import type { Logger } from '../../lib/logger.js'
import type { TutorProvider } from '../../lib/tutor/tutor.js'
import { createGuide, getGuide, updateStep } from './guide.service.js'
import { getAuth } from '../../http/get-auth.js'
import { pathId } from '../../http/path-id.js'
import { requireSession } from '../user/index.js'
import { updateStepSchema } from './guide.schema.js'

export function guideRouter(
  db: Db,
  config: Config,
  tutor: TutorProvider,
  logger: Pick<Logger, 'error'>
): Router {
  const router = Router()
  const session = requireSession(db, config)

  router.post('/api/thread/:id/guide', session, async (req, res) => {
    const guide = await createGuide(db, getAuth(req), { config, tutor, logger }, pathId(req))
    res.status(201).json({ guide })
  })

  router.get('/api/guide/:id', session, async (req, res) => {
    res.json({ guide: await getGuide(db, getAuth(req), pathId(req)) })
  })

  router.patch('/api/guide/:id/step/:stepId', session, async (req, res) => {
    const input = updateStepSchema.parse(req.body)
    const stepId = pathParam(req.params.stepId)
    res.json({ step: await updateStep(db, getAuth(req), pathId(req), stepId, input) })
  })

  return router
}
