import express, { type Express, type RequestHandler } from 'express'
import { RateLimiterRes, type RateLimiterPostgres } from 'rate-limiter-flexible'
import { afterEach, describe, expect, it } from 'vitest'
import { attachContext, ctxOf, servicesOf, type AppContext } from '../../src/context.js'
import { loadConfig } from '../../src/lib/config.js'
import { ERROR_MESSAGE } from '../../src/lib/error.js'
import { ipLimitKey, loginLimitKey } from '../../src/lib/rate-limit.js'
import { clientIp, rateLimitByIp, rateLimitByIpAndEmail } from '../../src/middleware/rate-limit.js'
import { requireAiEnabled } from '../../src/middleware/require-ai-enabled.js'
import { createBareApp, stopBareApps } from '../helper/bare-app.js'
import { http } from '../helper/client.js'

type ErrorBody = { error: { code: string; message: string } }

/** A limiter that records every key it is asked to consume and answers with `outcome`. */
function fakeLimiter(outcome: () => Promise<unknown> = () => Promise.resolve({})) {
  const keys: string[] = []
  const limiter = {
    consume: (key: string) => {
      keys.push(key)
      return outcome()
    }
  }
  return { limiter: limiter as unknown as RateLimiterPostgres, keys }
}

type TestContext = Pick<AppContext, 'config' | 'limiters'>

function testContext(
  overrides: { isAiEnabled?: boolean; limiters?: Partial<AppContext['limiters']> } = {}
): TestContext {
  const config = { ...loadConfig(process.env), isAiEnabled: overrides.isAiEnabled ?? true }
  const unused = fakeLimiter().limiter
  return {
    config,
    limiters: { login: unused, loginIp: unused, signup: unused, ...overrides.limiters }
  }
}

afterEach(stopBareApps)

/**
 * POST /probe runs `middleware`, then answers 200 with the `req.ip` it saw. The context holds only
 * what these middleware read.
 */
function appWith(context: TestContext | undefined, middleware: RequestHandler): Express {
  const app = createBareApp((app) => {
    app.post('/probe', middleware, (req, res) => {
      res.json({ ip: req.ip })
    })
  })
  if (context) attachContext(app, context as AppContext)
  return app
}

const MESSAGE = 'Too many attempts. Try again shortly.'

describe('rateLimitByIp', () => {
  it('consumes one point keyed on the client IP, then continues', async () => {
    const signup = fakeLimiter()
    const app = appWith(
      testContext({ limiters: { signup: signup.limiter } }),
      rateLimitByIp('signup', MESSAGE)
    )
    const res = await http(app).post('/probe')
    expect(res.status).toBe(200)
    expect(signup.keys).toEqual([ipLimitKey((res.body as { ip: string }).ip)])
  })

  it('answers 429 rate_limited with Retry-After when the limiter rejects', async () => {
    // rate-limiter-flexible rejects with a RateLimiterRes, not an Error; the fake does the same.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const signup = fakeLimiter(() => Promise.reject(new RateLimiterRes(0, 2_500)))
    const app = appWith(
      testContext({ limiters: { signup: signup.limiter } }),
      rateLimitByIp('signup', MESSAGE)
    )
    const res = await http(app).post('/probe')
    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBe('3')
    expect((res.body as ErrorBody).error).toEqual({ code: 'rate_limited', message: MESSAGE })
  })

  it('passes any other limiter failure through as a 500', async () => {
    const signup = fakeLimiter(() => Promise.reject(new Error('connection refused')))
    const app = appWith(
      testContext({ limiters: { signup: signup.limiter } }),
      rateLimitByIp('signup', MESSAGE)
    )
    const res = await http(app).post('/probe')
    expect(res.status).toBe(500)
    expect(res.headers['retry-after']).toBeUndefined()
    expect((res.body as ErrorBody).error.code).toBe('internal_error')
  })

  it('reads the limiter of the app serving the request', async () => {
    const middleware = rateLimitByIp('loginIp', MESSAGE)
    const first = fakeLimiter()
    const second = fakeLimiter()
    await http(appWith(testContext({ limiters: { loginIp: first.limiter } }), middleware)).post(
      '/probe'
    )
    await http(appWith(testContext({ limiters: { loginIp: second.limiter } }), middleware)).post(
      '/probe'
    )
    expect(first.keys).toHaveLength(1)
    expect(second.keys).toHaveLength(1)
  })
})

describe('rateLimitByIpAndEmail', () => {
  it('keys on the client IP and the email', async () => {
    const login = fakeLimiter()
    const app = appWith(
      testContext({ limiters: { login: login.limiter } }),
      rateLimitByIpAndEmail('login', MESSAGE)
    )
    const res = await http(app).post('/probe').send({ email: 'ada@example.com' })
    expect(res.status).toBe(200)
    const ip = (res.body as { ip: string }).ip
    expect(login.keys).toEqual([loginLimitKey(ip, 'ada@example.com')])
    expect(login.keys[0]).not.toBe(loginLimitKey(ip, 'grace@example.com'))
  })
})

describe('clientIp', () => {
  it('falls back to unknown when the socket has no address', () => {
    expect(clientIp({ ip: undefined })).toBe('unknown')
    expect(clientIp({ ip: '203.0.113.7' })).toBe('203.0.113.7')
  })
})

describe('requireAiEnabled', () => {
  it('answers 503 ai_unavailable when AI features are off', async () => {
    const res = await http(appWith(testContext({ isAiEnabled: false }), requireAiEnabled)).post(
      '/probe'
    )
    expect(res.status).toBe(503)
    expect((res.body as ErrorBody).error).toEqual({
      code: 'ai_unavailable',
      message: ERROR_MESSAGE.ai_unavailable
    })
  })

  it('continues when AI features are on', async () => {
    const res = await http(appWith(testContext({ isAiEnabled: true }), requireAiEnabled)).post(
      '/probe'
    )
    expect(res.status).toBe(200)
  })
})

describe('app context', () => {
  it('returns the context and services attached to the app', () => {
    const app = express()
    const context = { ...testContext(), services: {} } as AppContext
    attachContext(app, context)
    expect(ctxOf({ app })).toBe(context)
    expect(servicesOf({ app })).toBe(context.services)
  })

  it('throws when the app has no context', () => {
    expect(() => ctxOf({ app: express() })).toThrow(
      'AppContext missing: createApp() must call attachContext()'
    )
  })

  it('surfaces a missing context as a 500, not a silent pass', async () => {
    const res = await http(appWith(undefined, requireAiEnabled)).post('/probe')
    expect(res.status).toBe(500)
    expect((res.body as ErrorBody).error.code).toBe('internal_error')
  })
})
