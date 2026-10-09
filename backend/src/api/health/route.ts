import { Router } from 'express'
import { live, ready } from './controller.js'

const router = Router()

router.get('/health', live)
router.get('/ready', ready)

export default router
