import { describe, expect, it } from 'vitest'
import { configWarning, loadConfig, loadDbConfig } from '../../src/lib/config.js'

describe('loadConfig', () => {
  it('applies development defaults for an empty environment', () => {
    const config = loadConfig({})
    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 4000,
      host: '127.0.0.1',
      databaseUrl: 'postgres://ai_tutor:ai_tutor@localhost:5432/ai_tutor',
      frontendUrl: 'http://localhost:3000',
      logLevel: 'info',
      aiProvider: 'fake',
      aiModel: 'claude-haiku-4-5',
      aiDailyTokenBudget: 1_000_000,
      aiGlobalDailyTokenBudget: 1_000_000_000,
      isAiEnabled: true,
      aiFakeDelayMs: 20,
      shouldRecoverStaleOnBoot: true,
      signupRateLimit: 10,
      loginIpRateLimit: 30
    })
    expect(config.anthropicApiKey).toBeUndefined()
  })

  it('refuses AI_PROVIDER=fake in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://x',
        FRONTEND_URL: 'https://app.example.com',
        AI_PROVIDER: 'fake'
      })
    ).toThrow(/AI_PROVIDER/)
  })

  it('requires DATABASE_URL in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://app.example.com',
        AI_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'k'
      })
    ).toThrow(/DATABASE_URL/)
  })

  it('requires ANTHROPIC_API_KEY when AI_PROVIDER=anthropic', () => {
    expect(() => loadConfig({ AI_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/)
  })

  it('lists every invalid variable without echoing secret values', () => {
    const secret = 'sk-super-secret'
    let message = ''
    try {
      loadConfig({ PORT: 'abc', AI_DAILY_TOKEN_BUDGET: '-1', ANTHROPIC_API_KEY: secret })
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/PORT/)
    expect(message).toMatch(/AI_DAILY_TOKEN_BUDGET/)
    expect(message).not.toContain(secret)
  })

  it('parses AI_FAKE_DELAY_MS and rejects a negative value', () => {
    expect(loadConfig({ AI_FAKE_DELAY_MS: '0' }).aiFakeDelayMs).toBe(0)
    expect(() => loadConfig({ AI_FAKE_DELAY_MS: '-1' })).toThrow(/AI_FAKE_DELAY_MS/)
  })

  it('defaults the daily budget to 1,000,000 for the free fake provider', () => {
    expect(loadConfig({ AI_PROVIDER: 'fake' }).aiDailyTokenBudget).toBe(1_000_000)
  })

  it('defaults the daily budget to 50,000 for the anthropic provider', () => {
    expect(
      loadConfig({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }).aiDailyTokenBudget
    ).toBe(50_000)
  })

  it('defaults the global daily budget per provider', () => {
    expect(loadConfig({ AI_PROVIDER: 'fake' }).aiGlobalDailyTokenBudget).toBe(1_000_000_000)
    expect(
      loadConfig({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }).aiGlobalDailyTokenBudget
    ).toBe(500_000)
  })

  it('defaults TRUST_PROXY to 0, accepts a hop count and rejects anything else', () => {
    expect(loadConfig({}).trustProxy).toBe(0)
    expect(loadConfig({ TRUST_PROXY: '2' }).trustProxy).toBe(2)
    for (const bad of ['-1', '1.5', 'true', 'abc']) {
      expect(() => loadConfig({ TRUST_PROXY: bad })).toThrow(/TRUST_PROXY/)
    }
  })

  it('lets SIGNUP_RATE_LIMIT and LOGIN_IP_RATE_LIMIT override the defaults and rejects non-positive values', () => {
    const config = loadConfig({ SIGNUP_RATE_LIMIT: '3', LOGIN_IP_RATE_LIMIT: '7' })
    expect(config.signupRateLimit).toBe(3)
    expect(config.loginIpRateLimit).toBe(7)
    expect(() => loadConfig({ SIGNUP_RATE_LIMIT: '0' })).toThrow(/SIGNUP_RATE_LIMIT/)
    expect(() => loadConfig({ LOGIN_IP_RATE_LIMIT: '-1' })).toThrow(/LOGIN_IP_RATE_LIMIT/)
    expect(() => loadConfig({ LOGIN_IP_RATE_LIMIT: '1.5' })).toThrow(/LOGIN_IP_RATE_LIMIT/)
  })

  it('lets AI_GLOBAL_DAILY_TOKEN_BUDGET override the default and rejects a non-positive value', () => {
    expect(loadConfig({ AI_GLOBAL_DAILY_TOKEN_BUDGET: '777' }).aiGlobalDailyTokenBudget).toBe(777)
    expect(() => loadConfig({ AI_GLOBAL_DAILY_TOKEN_BUDGET: '0' })).toThrow(
      /AI_GLOBAL_DAILY_TOKEN_BUDGET/
    )
  })

  it('lets AI_DAILY_TOKEN_BUDGET override the default for either provider', () => {
    expect(loadConfig({ AI_DAILY_TOKEN_BUDGET: '1234' }).aiDailyTokenBudget).toBe(1234)
    expect(
      loadConfig({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', AI_DAILY_TOKEN_BUDGET: '99' })
        .aiDailyTokenBudget
    ).toBe(99)
  })

  it('parses RECOVER_STALE_ON_BOOT=false to false', () => {
    expect(loadConfig({ RECOVER_STALE_ON_BOOT: 'false' }).shouldRecoverStaleOnBoot).toBe(false)
  })

  it('parses AI_ENABLED=false to false', () => {
    expect(loadConfig({ AI_ENABLED: 'false' }).isAiEnabled).toBe(false)
  })

  it.each(['http://localhost:3000/', 'https://app.example.com/app', 'https://app.example.com?x=1'])(
    'rejects FRONTEND_URL that is not an exact origin: %s',
    (value) => {
      expect(() => loadConfig({ FRONTEND_URL: value })).toThrow(/FRONTEND_URL.*exact origin/)
    }
  )

  it('accepts an exact FRONTEND_URL origin', () => {
    expect(loadConfig({ FRONTEND_URL: 'https://app.example.com' }).frontendUrl).toBe(
      'https://app.example.com'
    )
  })
})

describe('loadDbConfig', () => {
  it('needs no AI settings, even in production', () => {
    expect(loadDbConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://db/x' })).toEqual({
      nodeEnv: 'production',
      databaseUrl: 'postgres://db/x',
      logLevel: 'info'
    })
  })

  it('defaults the database URL in development', () => {
    expect(loadDbConfig({}).databaseUrl).toBe(
      'postgres://ai_tutor:ai_tutor@localhost:5432/ai_tutor'
    )
  })

  it('requires DATABASE_URL in production and rejects a bad log level', () => {
    expect(() => loadDbConfig({ NODE_ENV: 'production' })).toThrow('DATABASE_URL')
    expect(() => loadDbConfig({ LOG_LEVEL: 'loud' })).toThrow('LOG_LEVEL')
  })
})

describe('configWarning', () => {
  it('warns when the global cap is below the per-user budget', () => {
    const config = loadConfig({
      AI_DAILY_TOKEN_BUDGET: '5000',
      AI_GLOBAL_DAILY_TOKEN_BUDGET: '1000'
    })
    expect(configWarning(config)).toMatch(/AI_GLOBAL_DAILY_TOKEN_BUDGET.*AI_DAILY_TOKEN_BUDGET/)
  })

  it('stays quiet when the cap equals or exceeds the budget, and for the defaults', () => {
    const equal = loadConfig({
      AI_DAILY_TOKEN_BUDGET: '5000',
      AI_GLOBAL_DAILY_TOKEN_BUDGET: '5000'
    })
    expect(configWarning(equal)).toBeUndefined()
    expect(configWarning(loadConfig({}))).toBeUndefined()
  })
})
