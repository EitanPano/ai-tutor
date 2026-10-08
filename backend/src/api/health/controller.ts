import type { RequestHandler } from 'express'
import { servicesOf } from '../../context.js'
import { ERROR_MESSAGE, serviceUnavailable } from '../../lib/error.js'
import type { ParamsDictionary, Query } from '../../middleware/validate.js'

/** Liveness: checks no dependency, so a database outage fails readiness and never liveness. */
export const live: RequestHandler<ParamsDictionary, unknown, unknown, Query> = (_req, res) => {
  res.json({ status: 'ok' })
}

/** Readiness: 503 `db_unavailable` while the database does not answer. */
export const ready: RequestHandler<ParamsDictionary, unknown, unknown, Query> = async (
  req,
  res
) => {
  // Resolved outside the try: only a failed ping means "not ready".
  const { health } = servicesOf(req)
  try {
    await health.ping()
  } catch (err) {
    req.log.warn({ err }, 'readiness check failed')
    throw serviceUnavailable('db_unavailable', ERROR_MESSAGE.db_unavailable)
  }
  res.json({ status: 'ready' })
}
