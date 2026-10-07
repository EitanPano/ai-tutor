import type { z } from 'zod'
import type { Config } from '../../lib/config.js'
import type { Db } from '../../lib/db/index.js'
import type { Logger } from '../../lib/logger.js'
import type { Auth } from '../../lib/ownership.js'
import { assertAiEnabled } from './ai-guard.js'
import { assertWithinBudget, recordAiCall, type AiCallRecord } from './ai-budget.js'
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
  /** 429 `ai_budget_exceeded` once today's tokens (user's time zone) reach AI_DAILY_TOKEN_BUDGET. */
  assertWithinBudget(auth: Auth): Promise<void>
  /** Appends one row to the `ai_call` ledger. */
  recordCall(auth: Auth, row: AiCallRecord): Promise<void>
  /** Per-user generation lock; 409 `generation_in_progress` while another generation holds it. */
  acquireLock(auth: Auth): Promise<GenerationLockToken>
  /** Releases only while `token` still owns the lock. Pass `tx` to release inside the caller's transaction. */
  releaseLock(auth: Auth, token: GenerationLockToken, tx?: Db): Promise<void>
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
  return {
    assertEnabled: () => assertAiEnabled(config),
    assertWithinBudget: (auth) =>
      assertWithinBudget(db, auth, config.aiDailyTokenBudget, config.aiGlobalDailyTokenBudget),
    recordCall: (auth, row) => recordAiCall(db, auth, row),
    acquireLock: (auth) => acquireGenerationLock(db, auth),
    releaseLock: (auth, token, tx = db) => releaseGenerationLock(tx, auth, token),
    releaseAllLocks: () => releaseAllGenerationLocks(db),
    generateValidated: (auth, options) => generateValidated(db, auth, { ...options, logger }),
    lockTtlSeconds: GENERATION_LOCK_TTL_SECONDS
  }
}
