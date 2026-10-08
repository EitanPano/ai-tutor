import { describe, expect, it } from 'vitest'
import { FAILED_NOTE, noteFor } from '@/component/thread/answer-note'
import type { Message } from '@/lib/api/thread'

const REFUSAL = "The tutor can't help with that question. Try rephrasing it."
const CUT_OFF = 'This answer was cut off at the length limit. Ask a follow-up to continue.'
const STOPPED = 'Stopped before the answer finished.'

type Case = [Message['status'], Message['stopReason'], string | null]

describe('noteFor', () => {
  it.each<Case>([
    ['failed', 'refusal', REFUSAL],
    ['failed', 'error', FAILED_NOTE],
    ['failed', 'end_turn', FAILED_NOTE],
    ['failed', null, FAILED_NOTE],
    ['incomplete', 'max_tokens', CUT_OFF],
    ['incomplete', 'aborted', STOPPED],
    ['incomplete', 'error', null],
    ['incomplete', 'refusal', null],
    ['incomplete', null, null],
    ['complete', 'end_turn', null],
    ['complete', 'max_tokens', null],
    ['complete', null, null]
  ])('%s with %s says %j', (status, stopReason, note) => {
    expect(noteFor({ status, stopReason })).toBe(note)
  })

  it('says a failed answer failed', () => {
    expect(FAILED_NOTE).toBe('This answer failed.')
  })
})
