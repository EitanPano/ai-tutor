import { Router } from 'express'
import { idParams } from '../../lib/validation.js'
import { requireSession } from '../../middleware/auth.js'
import { requireAiEnabled } from '../../middleware/require-ai-enabled.js'
import { validate } from '../../middleware/validate.js'
import { create, get, getAttempt, submitAttempt } from './controller.js'
import { attemptParams, createBody, submitAttemptBody } from './validation.js'

const router = Router()

const validateCreate = validate({ body: createBody })
const validateId = validate({ params: idParams })
const validateSubmitAttempt = validate({ params: idParams, body: submitAttemptBody })
const validateAttempt = validate({ params: attemptParams })

// The AI switch is the first check, before the body is looked at.
router.post('/api/quiz', requireSession, requireAiEnabled, validateCreate, create)
router.get('/api/quiz/:id', requireSession, validateId, get)
router.post('/api/quiz/:id/attempt', requireSession, validateSubmitAttempt, submitAttempt)
router.get('/api/quiz/:id/attempt/:attemptId', requireSession, validateAttempt, getAttempt)

export default router
