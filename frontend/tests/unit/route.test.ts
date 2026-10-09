import { describe, expect, it } from 'vitest'
import { isAuthPath, isPathUnder, isProtectedPath } from '@/lib/route'

describe('isPathUnder', () => {
  it.each([
    ['/thread', true],
    ['/thread/abc', true],
    ['/thread/abc/def', true],
    ['/threads', false],
    ['/threads-info', false],
    ['/', false],
    ['/guide/thread', false]
  ])('%s under /thread is %s', (pathname, expected) => {
    expect(isPathUnder(pathname, '/thread')).toBe(expected)
  })
})

describe('isProtectedPath', () => {
  it.each(['/thread', '/thread/abc', '/guide/1', '/quiz/2/attempt/3', '/progress'])(
    'protects %s',
    (pathname) => {
      expect(isProtectedPath(pathname)).toBe(true)
    }
  )

  it.each(['/', '/login', '/signup', '/threads-info', '/progressive'])(
    'leaves %s open',
    (pathname) => {
      expect(isProtectedPath(pathname)).toBe(false)
    }
  )
})

describe('isAuthPath', () => {
  it.each([
    ['/login', true],
    ['/signup', true],
    ['/login/help', true],
    ['/loginx', false],
    ['/thread', false],
    ['/', false]
  ])('%s is %s', (pathname, expected) => {
    expect(isAuthPath(pathname)).toBe(expected)
  })
})
