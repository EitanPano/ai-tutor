import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp } from '../helper/client.js'
import { parseSse } from '../helper/sse.js'

const ctx = createTestApp()
const client = createClient(ctx.app, ctx.config)

beforeEach(() => truncateAll(ctx.db))
afterAll(() => ctx.close())

describe('security headers', () => {
  it('sets helmet defaults on /health and does not advertise the framework', async () => {
    const res = await client.get('/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains')
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN')
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('sets them on an /api response too, including a 401', async () => {
    const res = await client.get('/api/thread')
    expect(res.status).toBe(401)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('still streams the SSE answer with the headers applied', async () => {
    const session = await signUp(client)
    const created = await client
      .post('/api/thread')
      .set('Cookie', session.cookie)
      .send({ topicId: 'react' })
    const threadId = (created.body as { thread: { id: string } }).thread.id
    const res = await client
      .post(`/api/thread/${threadId}/message`)
      .set('Cookie', session.cookie)
      .send({ content: 'Why does useEffect run twice?' })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    const names = parseSse(res.text).map((event) => event.event)
    expect(names[0]).toBe('message.start')
    expect(names.at(-1)).toBe('message.complete')
  })
})
