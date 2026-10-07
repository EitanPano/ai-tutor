import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LEGACY_TIME_ZONE } from '../../src/lib/time-zone.js'

const MIGRATION = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../db/migration/007-normalise-time-zone.sql'
)

describe('LEGACY_TIME_ZONE', () => {
  it('matches the table in migration 007', async () => {
    const sqlText = await readFile(MIGRATION, 'utf8')
    const pairs = [...sqlText.matchAll(/\('([^']+)', '([^']+)'\)/g)].map((m) => [m[1], m[2]])
    expect(Object.fromEntries(pairs)).toEqual(LEGACY_TIME_ZONE)
  })
})
