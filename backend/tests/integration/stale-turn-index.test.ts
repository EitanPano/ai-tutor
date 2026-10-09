import { CompiledQuery } from 'kysely'
import { afterAll, describe, expect, it } from 'vitest'
import { olderThanTtl, staleTurnQuery } from '../../src/api/thread/stale-turn.js'
import { createTestApp } from '../helper/app.js'

const ctx = createTestApp()

afterAll(() => ctx.close())

describe('stale-turn lookup', () => {
  it('is served by the partial in-flight index', async () => {
    const compiled = staleTurnQuery(ctx.db, olderThanTtl(600), {
      auth: { userId: 'u' },
      threadId: 't'
    }).compile()
    // Seq scans are disabled so the plan is deterministic even on a tiny table.
    const plan = await ctx.db.transaction().execute(async (trx) => {
      await trx.executeQuery(CompiledQuery.raw('SET LOCAL enable_seqscan = off'))
      const result = await trx.executeQuery<Record<string, string>>(
        CompiledQuery.raw(`EXPLAIN ${compiled.sql}`, [...compiled.parameters])
      )
      return result.rows.map((row) => Object.values(row)[0]).join('\n')
    })
    expect(plan).toContain('message_in_flight_idx')
  })
})
