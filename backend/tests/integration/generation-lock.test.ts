import { sql } from 'kysely'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp } from '../helper/client.js'

const ctx = createTestApp()
const client = createClient(ctx.app, ctx.config)

beforeEach(() => truncateAll(ctx.db))
afterAll(() => ctx.close())

async function lockOf(userId: string) {
  const row = await ctx.db
    .selectFrom('app_user')
    .select('generation_started_at')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow()
  return row.generation_started_at
}

describe('generation lock', () => {
  it('is exclusive and released by its own token', async () => {
    const { user } = await signUp(client)
    const auth = { userId: user.id }
    const token = await ctx.services.ai.acquireLock(auth)
    await expect(ctx.services.ai.acquireLock(auth)).rejects.toMatchObject({
      status: 409,
      code: 'generation_in_progress'
    })
    await ctx.services.ai.releaseLock(auth, token)
    expect(await lockOf(user.id)).toBeNull()
    await expect(ctx.services.ai.acquireLock(auth)).resolves.toEqual(expect.any(String))
  })

  it('does not let a taken-over generation release the new holder lock', async () => {
    const { user } = await signUp(client)
    const auth = { userId: user.id }
    const stale = await ctx.services.ai.acquireLock(auth)
    await sql`UPDATE app_user SET generation_started_at = now() - interval '11 minutes'`.execute(
      ctx.db
    )
    const current = await ctx.services.ai.acquireLock(auth)
    expect(current).not.toBe(stale)

    // The late release of the first (taken over) generation is a no-op.
    await ctx.services.ai.releaseLock(auth, stale)
    expect(await lockOf(user.id)).not.toBeNull()
    await expect(ctx.services.ai.acquireLock(auth)).rejects.toMatchObject({ status: 409 })

    await ctx.services.ai.releaseLock(auth, current)
    expect(await lockOf(user.id)).toBeNull()
  })

  it('never touches another user lock', async () => {
    const a = await signUp(client)
    const b = await signUp(client)
    const tokenA = await ctx.services.ai.acquireLock({ userId: a.user.id })
    const tokenB = await ctx.services.ai.acquireLock({ userId: b.user.id })
    await ctx.services.ai.releaseLock({ userId: b.user.id }, tokenA)
    expect(await lockOf(b.user.id)).not.toBeNull()
    await ctx.services.ai.releaseLock({ userId: b.user.id }, tokenB)
    expect(await lockOf(b.user.id)).toBeNull()
    expect(await lockOf(a.user.id)).not.toBeNull()
  })
})
