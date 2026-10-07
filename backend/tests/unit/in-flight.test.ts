import { describe, expect, it } from 'vitest'
import { InFlightRegistry } from '../../src/lib/in-flight.js'

describe('InFlightRegistry', () => {
  it('aborts every tracked controller and reports how many', () => {
    const registry = new InFlightRegistry()
    const a = new AbortController()
    const b = new AbortController()
    registry.track(a)
    registry.track(b)
    expect(registry.size).toBe(2)
    expect(registry.abortAll()).toBe(2)
    expect(a.signal.aborted).toBe(true)
    expect(b.signal.aborted).toBe(true)
    expect(registry.size).toBe(0)
  })

  it('does not abort a controller that was untracked', () => {
    const registry = new InFlightRegistry()
    const controller = new AbortController()
    const untrack = registry.track(controller)
    untrack()
    expect(registry.abortAll()).toBe(0)
    expect(controller.signal.aborted).toBe(false)
  })

  it('aborts a controller tracked after shutdown began', () => {
    const registry = new InFlightRegistry()
    registry.abortAll()
    const late = new AbortController()
    registry.track(late)
    expect(late.signal.aborted).toBe(true)
    expect(registry.size).toBe(0)
  })
})
