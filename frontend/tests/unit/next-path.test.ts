import { describe, expect, it } from 'vitest'
import { safeNextPath } from '@/lib/next-path'

describe('safeNextPath', () => {
  it.each([
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r/evil.com',
    decodeURIComponent('/%09/evil.com'),
    '//evil.com',
    'https://evil.com',
    '/\\evil.com',
    'javascript:alert(1)',
    '',
    'thread'
  ])('falls back to /thread for %j', (next) => {
    expect(safeNextPath(next)).toBe('/thread')
  })

  it('falls back for missing values', () => {
    expect(safeNextPath(undefined)).toBe('/thread')
    expect(safeNextPath(null)).toBe('/thread')
  })

  it('keeps an encoded tab as a literal path segment (it is same-site)', () => {
    expect(safeNextPath('/%09/evil.com')).toBe('/%09/evil.com')
  })

  it('keeps a valid relative path with query and hash', () => {
    expect(safeNextPath('/thread/abc?x=1')).toBe('/thread/abc?x=1')
    expect(safeNextPath('/progress#top')).toBe('/progress#top')
  })
})
