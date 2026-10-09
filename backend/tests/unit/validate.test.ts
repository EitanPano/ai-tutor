import type { Express } from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { validate } from '../../src/middleware/validate.js'
import { createBareApp, stopBareApps } from '../helper/bare-app.js'
import { http } from '../helper/client.js'

type ErrorBody = { error: { code: string; details?: { issues: { path: unknown[] }[] } } }

afterEach(stopBareApps)

const validateItem = validate({
  params: z.object({ id: z.coerce.number().int() }),
  query: z.object({ limit: z.coerce.number().int().min(1) }),
  body: z.object({ name: z.string().trim().min(1) })
})

/** Every part has a schema; the handler echoes what it reads and the runtime types it sees. */
function fullApp(): Express {
  return createBareApp((app) => {
    app.post('/item/:id', validateItem, (req, res) => {
      res.json({
        params: req.params,
        query: req.query,
        body: req.body,
        types: { id: typeof req.params.id, limit: typeof req.query.limit }
      })
    })
  })
}

describe('validate', () => {
  it('parses params, query and body and writes the parsed values back', async () => {
    const res = await http(fullApp())
      .post('/item/7?limit=20')
      .send({ name: '  Ada  ', extra: true })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      params: { id: 7 },
      query: { limit: 20 },
      // Trimmed, and the unknown key stripped: the handler reads the schema's output.
      body: { name: 'Ada' },
      types: { id: 'number', limit: 'number' }
    })
  })

  it.each([
    ['params', '/item/abc?limit=20', { name: 'Ada' }],
    ['query', '/item/7?limit=0', { name: 'Ada' }],
    ['body', '/item/7?limit=20', { name: '   ' }]
  ])('answers 400 validation_failed for an invalid %s', async (_part, path, body) => {
    const res = await http(fullApp()).post(path).send(body)
    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('validation_failed')
    expect((res.body as ErrorBody).error.details?.issues.length).toBeGreaterThan(0)
  })

  it('never reaches the handler when a part is invalid', async () => {
    let isReached = false
    const app = createBareApp((app) => {
      app.post('/item/:id', validateItem, (_req, res) => {
        isReached = true
        res.end()
      })
    })
    const res = await http(app).post('/item/abc?limit=20').send({ name: 'Ada' })
    expect(res.status).toBe(400)
    expect(isReached).toBe(false)
  })

  it('leaves the parts without a schema untouched', async () => {
    const app = createBareApp((app) => {
      app.post('/raw/:id', validate({ body: z.object({ name: z.string() }) }), (req, res) => {
        res.json({
          params: req.params,
          query: req.query,
          body: req.body,
          types: { id: typeof req.params.id }
        })
      })
      app.post('/body/:id', validate({ query: z.object({ flag: z.string() }) }), (req, res) => {
        res.json({ body: req.body })
      })
    })
    const raw = await http(app).post('/raw/42?limit=5&tag=a&tag=b').send({ name: 'Ada' })
    expect(raw.status).toBe(200)
    expect(raw.body).toEqual({
      params: { id: '42' },
      query: { limit: '5', tag: ['a', 'b'] },
      body: { name: 'Ada' },
      types: { id: 'string' }
    })
    const body = await http(app).post('/body/1?flag=x').send({ name: 'Ada', extra: 1 })
    expect(body.body).toEqual({ body: { name: 'Ada', extra: 1 } })
  })
})
