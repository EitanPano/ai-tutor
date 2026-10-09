import { servicesOf } from '../../context.js'
import type { Handler } from '../../middleware/validate.js'

/** The topic taxonomy, in display order. Public: no session. */
export const list: Handler = async (req, res) => {
  const topics = await servicesOf(req).topic.list()
  res.json({ topics })
}
