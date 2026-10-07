import type { z } from 'zod'
import type { Db } from '../../lib/db/index.js'
import type { Auth } from '../../lib/ownership.js'
import type { AiCallRecord } from './ai-budget.js'
import type { GenerateOptions } from './generate-validated.js'
import type { GenerationLockToken } from './generation-lock.js'
import { createAiService, type AiServiceDeps } from './ai.service.js'

/** What other modules may call: every ai method (the module has no router). */
export type AiApi = {
  /** The AI_ENABLED kill switch: 503 `ai_unavailable` when AI features are turned off. */
  assertEnabled(): void
  /** 429 `ai_budget_exceeded` once today's tokens (user's time zone) reach AI_DAILY_TOKEN_BUDGET. */
  assertWithinBudget(auth: Auth): Promise<void>
  /** Appends one row to the `ai_call` ledger. */
  recordCall(auth: Auth, row: AiCallRecord): Promise<void>
  /** Per-user generation lock; 409 `generation_in_progress` while another generation holds it. */
  acquireLock(auth: Auth): Promise<GenerationLockToken>
  /** Releases only while `token` still owns the lock. Pass `tx` to release inside the caller's transaction. */
  releaseLock(auth: Auth, token: GenerationLockToken, tx?: Db): Promise<void>
  /** One structured provider call validated by `schema`, retried once; records every call in `ai_call`. */
  generateValidated<S extends z.ZodType>(
    auth: Auth,
    options: GenerateOptions<S>
  ): Promise<z.output<S>>
  /** How long a generation lock or in-flight turn is trusted before it counts as abandoned. */
  readonly lockTtlSeconds: number
}
export type AiModuleDeps = AiServiceDeps

/**
 * Besides the api, the module returns `releaseAllLocks` for the boot recovery in `app.ts`. It is
 * not on `AiApi` because no other module may clear locks it does not hold.
 */
export type AiModule = {
  api: AiApi
  /** Clears every held generation lock, system-wide; returns how many were held. Boot only. */
  releaseAllLocks: () => Promise<number>
}

export function createAiModule(deps: AiModuleDeps): AiModule {
  const service = createAiService(deps)
  const api: AiApi = {
    assertEnabled: () => service.assertEnabled(),
    assertWithinBudget: (auth) => service.assertWithinBudget(auth),
    recordCall: (auth, row) => service.recordCall(auth, row),
    acquireLock: (auth) => service.acquireLock(auth),
    releaseLock: (auth, token, tx) => service.releaseLock(auth, token, tx),
    generateValidated: (auth, options) => service.generateValidated(auth, options),
    lockTtlSeconds: service.lockTtlSeconds
  }
  return { api, releaseAllLocks: () => service.releaseAllLocks() }
}
