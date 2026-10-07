import { randomUUID } from 'node:crypto'
import type { RequestHandler } from 'express'

const SANE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id')
  const id = incoming && SANE_REQUEST_ID.test(incoming) ? incoming : randomUUID()
  res.locals.requestId = id
  res.setHeader('X-Request-Id', id)
  next()
}
