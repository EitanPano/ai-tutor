import { z } from 'zod'

const DEV_DATABASE_URL = 'postgres://ai_tutor:ai_tutor@localhost:5432/ai_tutor'
const DEV_FRONTEND_URL = 'http://localhost:3000'

/** Daily token budgets, per user and across all users. */
type DailyTokenBudget = { perUser: number; global: number }

/**
 * Daily token budgets when AI_DAILY_TOKEN_BUDGET / AI_GLOBAL_DAILY_TOKEN_BUDGET are unset.
 * `perUser`: the real provider spends money, 50k tokens a day; the free fake one is effectively
 * unlimited. `global`: across all users, per UTC day, 500k tokens with the real provider,
 * effectively unlimited with the fake one.
 */
const DEFAULT_BUDGET_BY_PROVIDER: Record<Config['aiProvider'], DailyTokenBudget> = {
  anthropic: { perUser: 50_000, global: 500_000 },
  fake: { perUser: 1_000_000, global: 1_000_000_000 }
}

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
  SIGNUP_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  LOGIN_IP_RATE_LIMIT: z.coerce.number().int().positive().default(30),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  AI_ENABLED: boolString.default(true),
  AI_FAKE_DELAY_MS: z.coerce.number().int().min(0).default(20),
  RECOVER_STALE_ON_BOOT: boolString.default(true)
})

type Env = z.output<typeof envSchema>

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
  isAiEnabled: boolean
  aiFakeDelayMs: number
  shouldRecoverStaleOnBoot: boolean
  /** Reverse proxies in front of the backend whose X-Forwarded-For is trusted; 0 trusts none. */
  trustProxy: number
  /** Sign-ups per hour per IP. */
  signupRateLimit: number
  /** Login attempts per 15 minutes per IP, on top of the ip + email limit. */
  loginIpRateLimit: number
}

/** Variables that each parse on their own but are refused in this combination. */
type ConfigRule<V> = { isBrokenBy: (v: V) => boolean; problem: string }

const DATABASE_URL_RULE: ConfigRule<Pick<Env, 'NODE_ENV' | 'DATABASE_URL'>> = {
  isBrokenBy: (v) => v.NODE_ENV === 'production' && !v.DATABASE_URL,
  problem: 'DATABASE_URL: required in production'
}

/** Every rule that matches is reported, in this order. */
const CONFIG_RULES: readonly ConfigRule<Env>[] = [
  DATABASE_URL_RULE,
  {
    isBrokenBy: (v) => v.NODE_ENV === 'production' && !v.FRONTEND_URL,
    problem: 'FRONTEND_URL: required in production'
  },
  {
    isBrokenBy: (v) => v.NODE_ENV === 'production' && v.AI_PROVIDER === 'fake',
    problem: 'AI_PROVIDER: "fake" is not allowed in production'
  },
  {
    isBrokenBy: (v) => v.AI_PROVIDER === 'anthropic' && !v.ANTHROPIC_API_KEY,
    problem: 'ANTHROPIC_API_KEY: required when AI_PROVIDER=anthropic'
  }
]

/** Treat empty strings (e.g. an empty ANTHROPIC_API_KEY in a copied template) as unset. */
function withoutEmpty(vars: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined && value !== '') out[key] = value
  }
  return out
}

function invalidConfiguration(problems: readonly string[]): Error {
  return new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`)
}

/**
 * Parses `vars` with `schema`, then checks `rules`. Throws one error naming every invalid
 * variable, or else every broken rule.
 */
function parseEnv<S extends z.ZodType>(
  schema: S,
  rules: readonly ConfigRule<z.output<S>>[],
  vars: NodeJS.ProcessEnv
): z.output<S> {
  const parsed = schema.safeParse(withoutEmpty(vars))
  if (!parsed.success) {
    throw invalidConfiguration(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    )
  }
  const problems = rules.filter((rule) => rule.isBrokenBy(parsed.data)).map((rule) => rule.problem)
  if (problems.length > 0) throw invalidConfiguration(problems)
  return parsed.data
}

/**
 * Validates env vars and returns a typed config. Throws one error naming every invalid
 * variable. Never prints variable values, so secrets cannot leak into logs.
 */
export function loadConfig(vars: NodeJS.ProcessEnv = process.env): Config {
  const v = parseEnv(envSchema, CONFIG_RULES, vars)
  const defaultBudget = DEFAULT_BUDGET_BY_PROVIDER[v.AI_PROVIDER]
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
    aiDailyTokenBudget: v.AI_DAILY_TOKEN_BUDGET ?? defaultBudget.perUser,
    aiGlobalDailyTokenBudget: v.AI_GLOBAL_DAILY_TOKEN_BUDGET ?? defaultBudget.global,
    isAiEnabled: v.AI_ENABLED,
    aiFakeDelayMs: v.AI_FAKE_DELAY_MS,
    shouldRecoverStaleOnBoot: v.RECOVER_STALE_ON_BOOT,
    trustProxy: v.TRUST_PROXY,
    signupRateLimit: v.SIGNUP_RATE_LIMIT,
    loginIpRateLimit: v.LOGIN_IP_RATE_LIMIT
  }
}

/**
 * A settings mistake that does not stop boot: with the global cap below the per-user budget, one
 * user can never spend their whole budget, because the cap pauses everyone first.
 */
export function configWarning(
  config: Pick<Config, 'aiDailyTokenBudget' | 'aiGlobalDailyTokenBudget'>
): string | undefined {
  if (config.aiGlobalDailyTokenBudget < config.aiDailyTokenBudget) {
    return `AI_GLOBAL_DAILY_TOKEN_BUDGET (${config.aiGlobalDailyTokenBudget}) is below AI_DAILY_TOKEN_BUDGET (${config.aiDailyTokenBudget}): the global cap will pause AI before any user reaches their own budget`
  }
  return undefined
}

const dbEnvSchema = envSchema.pick({ NODE_ENV: true, DATABASE_URL: true, LOG_LEVEL: true })

type DbConfig = Pick<Config, 'nodeEnv' | 'databaseUrl' | 'logLevel'>

/**
 * The narrow config the db CLI (migrate, seed, reset-password, ...) needs: it must run in an
 * image or shell that has no AI settings, so it never validates them.
 */
export function loadDbConfig(vars: NodeJS.ProcessEnv = process.env): DbConfig {
  const v = parseEnv(dbEnvSchema, [DATABASE_URL_RULE], vars)
  return {
    nodeEnv: v.NODE_ENV,
    databaseUrl: v.DATABASE_URL ?? DEV_DATABASE_URL,
    logLevel: v.LOG_LEVEL
  }
}
