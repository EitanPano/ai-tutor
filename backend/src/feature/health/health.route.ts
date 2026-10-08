import { Router } from 'express'
import { sql } from 'kysely'
import type { Db } from '../../lib/db/index.js'
import { ERROR_MESSAGE, serviceUnavailable } from '../../lib/error.js'

export function healthRouter(db: Db): Router {
  const router = Router()

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  router.get('/ready', async (req, res) => {
    try {
      await sql`SELECT 1`.execute(db)
    } catch (err) {
      req.log.warn({ err }, 'readiness check failed')
      throw serviceUnavailable('db_unavailable', ERROR_MESSAGE.db_unavailable)
    }
    res.json({ status: 'ready' })
  })

  return router
}
