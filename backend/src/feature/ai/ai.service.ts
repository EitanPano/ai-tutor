import type { z } from 'zod'
import type { Config } from '../../lib/config.js'
import type { Db } from '../../lib/db/index.js'
import type { Logger } from '../../lib/logger.js'
import type { Auth } from '../../lib/ownership.js'
import { assertAiEnabled } from './ai-guard.js'
import { assertWithinBudget, recordAiCall, type AiCall } from './ai-budget.js'
import { generateValidated, type GenerateOptions } from './generate-validated.js'
import {
  acquireGenerationLock,
  releaseAllGenerationLocks,
  releaseGenerationLock,
  GENERATION_LOCK_TTL_SECONDS,
  type GenerationLockToken
} from './generation-lock.js'

export type AiServiceDeps = {
  db: Db
  config: Pick<Config, 'aiEnabled' | 'aiDailyTokenBudget' | 'aiGlobalDailyTokenBudget'>
  logger: Pick<Logger, 'error'>
}

/** Every ai method is public: the module has no router. */
export type AiService = {
  /** The AI_ENABLED kill switch: 503 `ai_unavailable` when AI features are turned off. */
  assertEnabled(): void
  /**
   * 429 `ai_budget_exceeded` once today's tokens (user's time zone) reach AI_DAILY_TOKEN_BUDGET; then
   * 503 `ai_unavailable` once all users' tokens today (UTC day) reach AI_GLOBAL_DAILY_TOKEN_BUDGET.
   */
  assertWithinBudget(auth: Auth): Promise<void>
  /** Appends one row to the `ai_call` ledger. */
  recordCall(auth: Auth, call: AiCall): Promise<void>
  /** Per-user generation lock; 409 `generation_in_progress` while another generation holds it. */
  acquireLock(auth: Auth): Promise<GenerationLockToken>
  /** Releases only while `token` still owns the lock. Pass `tx` to release inside the caller's transaction. */
  releaseLock(auth: Auth, token: GenerationLockToken, tx?: Db): Promise<void>
  /** Kill-switch backstop, budget check, lock, `fn`, release in `finally`; see `AiApi.withGenerationLock`. */
  withGenerationLock<T>(auth: Auth, fn: () => Promise<T>): Promise<T>
  /** Clears every held lock, system-wide; returns the count. Boot recovery only. */
  releaseAllLocks(): Promise<number>
  /** One structured provider call validated by `schema`, retried once; records every call in `ai_call`. */
  generateValidated<S extends z.ZodType>(
    auth: Auth,
    options: GenerateOptions<S>
  ): Promise<z.output<S>>
  /** How long a generation lock or in-flight turn is trusted before it counts as abandoned. */
  readonly lockTtlSeconds: number
}

export function createAiService({ db, config, logger }: AiServiceDeps): AiService {
  const assertWithinBudgetFor = (auth: Auth) =>
    assertWithinBudget(db, auth, config.aiDailyTokenBudget, config.aiGlobalDailyTokenBudget)
  return {
    assertEnabled: () => assertAiEnabled(config),
    assertWithinBudget: assertWithinBudgetFor,
    recordCall: (auth, call) => recordAiCall(db, auth, call),
    acquireLock: (auth) => acquireGenerationLock(db, auth),
    releaseLock: (auth, token, tx = db) => releaseGenerationLock(tx, auth, token),
    async withGenerationLock(auth, fn) {
      // Backstop; the route checks first so the error order stays kill switch → body.
      assertAiEnabled(config)
      await assertWithinBudgetFor(auth)
      const token = await acquireGenerationLock(db, auth)
      try {
        return await fn()
      } finally {
        await releaseGenerationLock(db, auth, token)
      }
    },
    releaseAllLocks: () => releaseAllGenerationLocks(db),
    generateValidated: (auth, options) => generateValidated(db, auth, { ...options, logger }),
    lockTtlSeconds: GENERATION_LOCK_TTL_SECONDS
  }
}
