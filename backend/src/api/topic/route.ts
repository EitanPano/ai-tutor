import { Router } from 'express'
import { list } from './controller.js'

const router = Router()

router.get('/api/topic', list)

export default router
