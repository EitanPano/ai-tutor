import type { RequestHandler } from 'express'
import { servicesOf } from '../../context.js'
import type { ParamsDictionary, Query } from '../../middleware/validate.js'

/** The topic taxonomy, in display order. Public: no session. */
export const list: RequestHandler<ParamsDictionary, unknown, unknown, Query> = async (req, res) => {
  const topics = await servicesOf(req).topic.list()
  res.json({ topics })
}
