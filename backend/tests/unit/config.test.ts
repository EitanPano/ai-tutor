import { describe, expect, it } from 'vitest'
import { loadConfig, loadDbConfig } from '../../src/lib/config.js'

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
      aiDailyTokenBudget: 50000,
      aiEnabled: true,
      aiFakeDelayMs: 20
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

  it('parses AI_ENABLED=false to false', () => {
    expect(loadConfig({ AI_ENABLED: 'false' }).aiEnabled).toBe(false)
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
