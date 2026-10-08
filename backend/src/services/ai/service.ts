import type { z } from 'zod'
import type { Config } from '../../lib/config.js'
import type { Db } from '../../lib/db/index.js'
import type { Logger } from '../../lib/logger.js'
import type { Auth } from '../../lib/ownership.js'
import { assertAiEnabled } from '../../lib/ai-enabled.js'
import { assertWithinBudget, recordAiCall, type AiCall } from './budget.js'
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

/** Every ai method: `app.ts` holds the whole service; other modules receive it as `AiApi`. */
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
  /**
   * Runs `fn` under the generation lock: a kill-switch backstop (503 `ai_unavailable`), the budget
   * check (429 `ai_budget_exceeded`, then the global cap 503 `ai_unavailable`), then the lock (409
   * `generation_in_progress`), and always releases it. The routes check the kill switch first (before
   * body validation); callers do their own lookups before this. Use it for any generation that
   * finishes inside the request; one whose lock outlives the request holds `acquireLock` itself.
   */
  withGenerationLock<T>(auth: Auth, fn: () => Promise<T>): Promise<T>
  /** Clears every held generation lock, system-wide; returns how many were held. Boot recovery only. */
  releaseAllLocks(): Promise<number>
  /** One structured provider call validated by `schema`, retried once; records every call in `ai_call`. */
  generateValidated<S extends z.ZodType>(
    auth: Auth,
    options: GenerateOptions<S>
  ): Promise<z.output<S>>
  /** How long a generation lock or in-flight turn is trusted before it counts as abandoned. */
  readonly lockTtlSeconds: number
}

/**
 * What other modules may call: every ai method but `releaseAllLocks`, which only the boot recovery
 * in `app.ts` uses, because no other module may clear locks it does not hold.
 */
export type AiApi = Omit<AiService, 'releaseAllLocks'>

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
