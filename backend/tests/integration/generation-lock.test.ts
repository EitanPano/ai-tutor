import { sql } from 'kysely'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, truncateAll } from '../helper/app.js'
import { createClient, signUp } from '../helper/client.js'
import { acquireGenerationLock, releaseGenerationLock } from '../../src/service/generation-lock.js'

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
    const token = await acquireGenerationLock(ctx.db, auth)
    await expect(acquireGenerationLock(ctx.db, auth)).rejects.toMatchObject({
      status: 409,
      code: 'generation_in_progress'
    })
    await releaseGenerationLock(ctx.db, auth, token)
    expect(await lockOf(user.id)).toBeNull()
    await expect(acquireGenerationLock(ctx.db, auth)).resolves.toEqual(expect.any(String))
  })

  it('does not let a taken-over generation release the new holder lock', async () => {
    const { user } = await signUp(client)
    const auth = { userId: user.id }
    const stale = await acquireGenerationLock(ctx.db, auth)
    await sql`UPDATE app_user SET generation_started_at = now() - interval '6 minutes'`.execute(
      ctx.db
    )
    const current = await acquireGenerationLock(ctx.db, auth)
    expect(current).not.toBe(stale)

    // The late release of the first (taken over) generation is a no-op.
    await releaseGenerationLock(ctx.db, auth, stale)
    expect(await lockOf(user.id)).not.toBeNull()
    await expect(acquireGenerationLock(ctx.db, auth)).rejects.toMatchObject({ status: 409 })

    await releaseGenerationLock(ctx.db, auth, current)
    expect(await lockOf(user.id)).toBeNull()
  })

  it('never touches another user lock', async () => {
    const a = await signUp(client)
    const b = await signUp(client)
    const tokenA = await acquireGenerationLock(ctx.db, { userId: a.user.id })
    const tokenB = await acquireGenerationLock(ctx.db, { userId: b.user.id })
    await releaseGenerationLock(ctx.db, { userId: b.user.id }, tokenA)
    expect(await lockOf(b.user.id)).not.toBeNull()
    await releaseGenerationLock(ctx.db, { userId: b.user.id }, tokenB)
    expect(await lockOf(b.user.id)).toBeNull()
    expect(await lockOf(a.user.id)).not.toBeNull()
  })
})
