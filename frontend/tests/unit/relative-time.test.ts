import { describe, expect, it } from 'vitest'
import { relativeTime } from '@/lib/relative-time'

const now = Date.parse('2026-10-06T12:00:00Z')
const ago = (ms: number) => new Date(now - ms).toISOString()

describe('relativeTime', () => {
  it.each([
    [10_000, 'just now'],
    [5 * 60_000, '5m ago'],
    [2 * 3_600_000, '2h ago'],
    [3 * 86_400_000, '3d ago']
  ])('%i ms ago reads %s', (ms, expected) => {
    expect(relativeTime(ago(ms), now)).toBe(expected)
  })

  it('treats a future timestamp as just now and a bad one as empty', () => {
    expect(relativeTime(ago(-5000), now)).toBe('just now')
    expect(relativeTime('nope', now)).toBe('')
  })
})
