import { describe, expect, it } from 'vitest'
import { ApiError, describeError, isRetryable, messageFor } from '@/lib/api/error'

const err = (code: string) => new ApiError({ status: 500, code, message: 'x' })

describe('isRetryable', () => {
  it.each([
    ['ai_provider_error', true, true],
    ['stream_interrupted', true, false],
    ['network_error', true, true],
    ['generation_in_progress', true, true],
    ['ai_invalid_output', false, true],
    ['ai_refused', false, false],
    ['thread_full', false, false],
    ['ai_budget_exceeded', false, false]
  ])('%s: ask %s, generate %s', (code, ask, generate) => {
    expect(isRetryable(err(code), 'ask')).toBe(ask)
    expect(isRetryable(err(code), 'generate')).toBe(generate)
  })

  it('never retries a value that is not an ApiError', () => {
    expect(isRetryable(new Error('network_error'), 'ask')).toBe(false)
    expect(isRetryable('network_error', 'generate')).toBe(false)
    expect(isRetryable(undefined, 'generate')).toBe(false)
  })
})

describe('messageFor', () => {
  it.each([
    [
      'ai_budget_exceeded',
      "You've used today's AI budget. It resets at midnight in your time zone."
    ],
    ['thread_full', 'This thread is full. Start a new thread to keep going.'],
    ['ai_refused', "The tutor can't help with that question. Try rephrasing it."]
  ] as const)('states %s the way describeError does', (code, sentence) => {
    expect(messageFor(code)).toBe(sentence)
    expect(describeError(err(code))).toBe(sentence)
  })
})

describe('describeError', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'never reads the prototype key %s as a known code',
    (code) => {
      expect(describeError(new ApiError({ status: 400, code, message: 'Server says' }))).toBe(
        'Server says'
      )
    }
  )
})
