import { Router } from 'express'
import { requireSession } from '../../middleware/auth.js'
import { get } from './controller.js'

const router = Router()

router.get('/api/progress', requireSession, get)

export default router
