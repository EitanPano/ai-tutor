import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../src/lib/db/index.js'
import type { AiApi } from '../../src/services/ai/index.js'
import { createMessageService } from '../../src/api/thread/message.service.js'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp } from '../helper/client.js'

// The routes check the kill switch first (before body validation); these call the services
// directly to prove the backstop holds for a caller that skips the route.
const off = createTestApp({ config: { aiEnabled: false } })
const client = createClient(off.app, off.config)

beforeEach(() => truncateAll(off.db))
afterAll(() => off.close())

describe('kill-switch backstop', () => {
  it('withGenerationLock answers 503 ai_unavailable with AI off, without running fn or locking', async () => {
    const { user } = await signUp(client)
    let ran = false
    await expect(
      off.modules.ai.withGenerationLock({ userId: user.id }, () => {
        ran = true
        return Promise.resolve()
      })
    ).rejects.toMatchObject({ status: 503, code: 'ai_unavailable' })
    expect(ran).toBe(false)
    const row = await off.db
      .selectFrom('app_user')
      .select('generation_started_at')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow()
    expect(row.generation_started_at).toBeNull()
  })

  it('the explain path answers 503 ai_unavailable with AI off, before touching the database', async () => {
    const ai: AiApi = off.modules.ai
    const message = createMessageService({
      db: {} as Db,
      topic: {} as never,
      ai,
      thread: {} as never,
      logger: { error: () => undefined, warn: () => undefined }
    })
    await expect(message.start({ userId: 'u' }, 't', 'hello')).rejects.toMatchObject({
      status: 503,
      code: 'ai_unavailable'
    })
  })
})
