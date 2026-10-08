import { servicesOf } from '../../context.js'
import { getAuth } from '../../middleware/auth.js'
import type { Handler } from '../../middleware/validate.js'

/** The signed-in user's totals, streak, per-topic progress and recent activity. */
export const get: Handler = async (req, res) => {
  const progress = await servicesOf(req).progress.get(getAuth(req))
  res.json(progress)
}
