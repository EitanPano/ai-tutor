import { Router } from 'express'
import { idParams } from '../../lib/validation.js'
import { requireSession } from '../../middleware/auth.js'
import { requireAiEnabled } from '../../middleware/require-ai-enabled.js'
import { validate } from '../../middleware/validate.js'
import { create, get, updateStep } from './controller.js'
import { stepParams, updateStepBody } from './validation.js'

const router = Router()

const validateId = validate({ params: idParams })
const validateUpdateStep = validate({ params: stepParams, body: updateStepBody })

// The AI switch is the first check, before the request is looked at (same as the quiz and ask).
router.post('/api/thread/:id/guide', requireSession, requireAiEnabled, validateId, create)
router.get('/api/guide/:id', requireSession, validateId, get)
router.patch('/api/guide/:id/step/:stepId', requireSession, validateUpdateStep, updateStep)

export default router
