import { Router } from 'express'
import { idParams } from '../../lib/validation.js'
import { requireSession } from '../../middleware/auth.js'
import { requireAiEnabled } from '../../middleware/require-ai-enabled.js'
import { validate } from '../../middleware/validate.js'
import { ask, create, get, list, remove, update } from './controller.js'
import { askBody, createBody, listQuery, updateBody } from './validation.js'

const router = Router()

const validateList = validate({ query: listQuery })
const validateCreate = validate({ body: createBody })
const validateId = validate({ params: idParams })
const validateUpdate = validate({ params: idParams, body: updateBody })
const validateAsk = validate({ params: idParams, body: askBody })

router.get('/api/thread', requireSession, validateList, list)
router.post('/api/thread', requireSession, validateCreate, create)
router.get('/api/thread/:id', requireSession, validateId, get)
router.patch('/api/thread/:id', requireSession, validateUpdate, update)
router.delete('/api/thread/:id', requireSession, validateId, remove)
// The AI switch is the first check, before the body is looked at (same order as the quiz).
router.post('/api/thread/:id/message', requireSession, requireAiEnabled, validateAsk, ask)

export default router
