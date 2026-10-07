import { describe, expect, it } from 'vitest'
import { capHistory, HISTORY_CHAR_LIMIT, type TutorTurn } from '../../src/lib/tutor/tutor.js'

const turn = (role: TutorTurn['role'], size: number, mark = 'x'): TutorTurn => ({
  role,
  content: mark.repeat(size)
})

describe('capHistory', () => {
  it('keeps a history under the limit unchanged', () => {
    const history = [turn('user', 100), turn('assistant', 200)]
    expect(capHistory(history)).toEqual(history)
  })

  it('keeps a history exactly at the limit', () => {
    const history = [turn('user', HISTORY_CHAR_LIMIT - 10), turn('assistant', 10)]
    expect(capHistory(history)).toEqual(history)
  })

  it('drops the oldest turns past the limit and keeps order', () => {
    const history = [
      turn('user', 30_000, 'a'),
      turn('assistant', 1_000, 'b'),
      turn('user', 30_000, 'c'),
      turn('assistant', 1_000, 'd'),
      turn('user', 30_000, 'e'),
      turn('assistant', 1_000, 'f')
    ]
    // Newest five turns would be 93k; c + d + e + f = 62k fits, b would not.
    expect(capHistory(history)).toEqual(history.slice(2))
  })

  it('never starts with an assistant turn', () => {
    const history = [
      turn('user', 40_000, 'a'),
      turn('assistant', 20_000, 'b'),
      turn('user', 20_000, 'c'),
      turn('assistant', 20_000, 'd')
    ]
    // b + c + d fit (60k) but b is a leading assistant turn.
    expect(capHistory(history)).toEqual(history.slice(2))
  })

  it('returns an empty history for an empty one', () => {
    expect(capHistory([])).toEqual([])
  })
})
