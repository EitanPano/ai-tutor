import { afterAll, describe, expect, it } from 'vitest'
import { createTestApp } from '../helper/app.js'
import { createClient } from '../helper/client.js'
import { expectContract } from '../helper/contract.js'

const ctx = createTestApp()
const client = createClient(ctx.app, ctx.config)

afterAll(() => ctx.close())

describe('GET /api/topic', () => {
  it('lists the frozen taxonomy in order, without a session', async () => {
    const res = await client.get('/api/topic')
    expect(res.status).toBe(200)
    expectContract(res, 'get', '/api/topic')
    const { topics } = res.body as { topics: { id: string; name: string }[] }
    expect(topics.map((topic) => topic.id)).toEqual([
      'react',
      'typescript',
      'javascript',
      'node',
      'css',
      'sql',
      'git',
      'docker',
      'testing',
      'python',
      'algorithms',
      'other'
    ])
    expect(topics[3]).toEqual({ id: 'node', name: 'Node.js' })
    expect(topics[10]).toEqual({ id: 'algorithms', name: 'Algorithms and data structures' })
  })

  it('answers 500 in the standard error shape when the database fails', async () => {
    const broken = createTestApp({
      databaseUrl: 'postgres://ai_tutor:ai_tutor@localhost:5432/does_not_exist'
    })
    try {
      const res = await createClient(broken.app, broken.config).get('/api/topic')
      expect(res.status).toBe(500)
      expectContract(res, 'get', '/api/topic')
      expect((res.body as { error: { code: string } }).error.code).toBe('internal_error')
    } finally {
      await broken.close()
    }
  })
})
