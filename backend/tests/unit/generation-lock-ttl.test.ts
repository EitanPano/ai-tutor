import { describe, expect, it } from 'vitest'
import {
  PROVIDER_MAX_RETRIES,
  PROVIDER_TIMEOUT_MS
} from '../../src/lib/tutor/anthropic.provider.js'
import { MAX_ATTEMPTS } from '../../src/service/generate-validated.js'
import { GENERATION_LOCK_TTL_SECONDS } from '../../src/service/generation-lock.js'

describe('generation lock TTL', () => {
  it('outlasts the worst-case generation (timeout x SDK attempts x validation attempts)', () => {
    const worstCaseSeconds =
      (PROVIDER_TIMEOUT_MS / 1000) * (PROVIDER_MAX_RETRIES + 1) * MAX_ATTEMPTS
    expect(GENERATION_LOCK_TTL_SECONDS).toBeGreaterThan(worstCaseSeconds)
  })
})
