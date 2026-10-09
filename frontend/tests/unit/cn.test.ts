import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/cn'

describe('cn', () => {
  it('joins class names with single spaces', () => {
    expect(cn('rounded-md border', 'p-4')).toBe('rounded-md border p-4')
  })

  it('drops falsy values, so a condition or a missing className leaves no gap', () => {
    const isOn = false
    expect(cn('base', isOn && 'on', undefined, null, '', 'extra')).toBe('base extra')
    expect(cn('base', undefined)).toBe('base')
  })

  it('is empty when nothing is left', () => {
    expect(cn(false, undefined)).toBe('')
  })
})
