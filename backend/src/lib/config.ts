import { z } from 'zod'

const DEV_DATABASE_URL = 'postgres://ai_tutor:ai_tutor@localhost:5432/ai_tutor'
const DEV_FRONTEND_URL = 'http://localhost:3000'
/** The real provider spends money: 50k tokens a day. The free fake one is effectively unlimited. */
const DEFAULT_BUDGET_ANTHROPIC = 50_000
const DEFAULT_BUDGET_FAKE = 1_000_000
/** Across all users, per UTC day: 500k tokens with the real provider, effectively unlimited with the fake one. */
const DEFAULT_GLOBAL_BUDGET_ANTHROPIC = 500_000
const DEFAULT_GLOBAL_BUDGET_FAKE = 1_000_000_000

const boolString = z.enum(['true', 'false']).transform((value) => value === 'true')

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_URL: z.string().min(1).optional(),
  FRONTEND_URL: z
    .url()
    .refine((value) => new URL(value).origin === value, {
      message: 'must be an exact origin like https://app.example.com (no trailing slash or path)'
    })
    .optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  AI_PROVIDER: z.enum(['fake', 'anthropic']).default('fake'),
  AI_MODEL: z.string().min(1).default('claude-haiku-4-5'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // The default depends on the provider, so it is applied in loadConfig.
  AI_DAILY_TOKEN_BUDGET: z.coerce.number().int().positive().optional(),
  AI_GLOBAL_DAILY_TOKEN_BUDGET: z.coerce.number().int().positive().optional(),
  AI_ENABLED: boolString.default(true),
  AI_FAKE_DELAY_MS: z.coerce.number().int().min(0).default(20),
  RECOVER_STALE_ON_BOOT: boolString.default(true)
})

export type Config = {
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  host: string
  databaseUrl: string
  frontendUrl: string
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  aiProvider: 'fake' | 'anthropic'
  aiModel: string
  anthropicApiKey: string | undefined
  aiDailyTokenBudget: number
  aiGlobalDailyTokenBudget: number
  aiEnabled: boolean
  aiFakeDelayMs: number
  recoverStaleOnBoot: boolean
}

/** Treat empty strings (e.g. an empty ANTHROPIC_API_KEY in a copied template) as unset. */
function withoutEmpty(vars: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined && value !== '') out[key] = value
  }
  return out
}

/**
 * Validates env vars and returns a typed config. Throws one error naming every invalid
 * variable. Never prints variable values, so secrets cannot leak into logs.
 */
export function loadConfig(vars: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(withoutEmpty(vars))
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    throw new Error(`Invalid configuration:\n- ${lines.join('\n- ')}`)
  }
  const v = parsed.data
  const production = v.NODE_ENV === 'production'
  const problems: string[] = []

  if (production && !v.DATABASE_URL) problems.push('DATABASE_URL: required in production')
  if (production && !v.FRONTEND_URL) problems.push('FRONTEND_URL: required in production')
  if (production && v.AI_PROVIDER === 'fake') {
    problems.push('AI_PROVIDER: "fake" is not allowed in production')
  }
  if (v.AI_PROVIDER === 'anthropic' && !v.ANTHROPIC_API_KEY) {
    problems.push('ANTHROPIC_API_KEY: required when AI_PROVIDER=anthropic')
  }
  if (problems.length > 0) throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`)

  return {
    nodeEnv: v.NODE_ENV,
    port: v.PORT,
    host: v.HOST,
    databaseUrl: v.DATABASE_URL ?? DEV_DATABASE_URL,
    frontendUrl: v.FRONTEND_URL ?? DEV_FRONTEND_URL,
    logLevel: v.LOG_LEVEL,
    aiProvider: v.AI_PROVIDER,
    aiModel: v.AI_MODEL,
    anthropicApiKey: v.ANTHROPIC_API_KEY,
    aiDailyTokenBudget:
      v.AI_DAILY_TOKEN_BUDGET ??
      (v.AI_PROVIDER === 'fake' ? DEFAULT_BUDGET_FAKE : DEFAULT_BUDGET_ANTHROPIC),
    aiGlobalDailyTokenBudget:
      v.AI_GLOBAL_DAILY_TOKEN_BUDGET ??
      (v.AI_PROVIDER === 'fake' ? DEFAULT_GLOBAL_BUDGET_FAKE : DEFAULT_GLOBAL_BUDGET_ANTHROPIC),
    aiEnabled: v.AI_ENABLED,
    aiFakeDelayMs: v.AI_FAKE_DELAY_MS,
    recoverStaleOnBoot: v.RECOVER_STALE_ON_BOOT
  }
}

const dbEnvSchema = envSchema.pick({ NODE_ENV: true, DATABASE_URL: true, LOG_LEVEL: true })

export type DbConfig = Pick<Config, 'nodeEnv' | 'databaseUrl' | 'logLevel'>

/**
 * The narrow config the db CLI (migrate, seed, reset-password, ...) needs: it must run in an
 * image or shell that has no AI settings, so it never validates them.
 */
export function loadDbConfig(vars: NodeJS.ProcessEnv = process.env): DbConfig {
  const parsed = dbEnvSchema.safeParse(withoutEmpty(vars))
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    throw new Error(`Invalid configuration:\n- ${lines.join('\n- ')}`)
  }
  const v = parsed.data
  if (v.NODE_ENV === 'production' && !v.DATABASE_URL) {
    throw new Error('Invalid configuration:\n- DATABASE_URL: required in production')
  }
  return {
    nodeEnv: v.NODE_ENV,
    databaseUrl: v.DATABASE_URL ?? DEV_DATABASE_URL,
    logLevel: v.LOG_LEVEL
  }
}
