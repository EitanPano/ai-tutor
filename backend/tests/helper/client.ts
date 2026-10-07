import { Agent, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Express } from 'express'
import request from 'supertest'
import type { Config } from '../../src/lib/config.js'

type Req = ReturnType<typeof request>
type Test = ReturnType<Req['get']>

export type UserBody = {
  id: string
  email: string
  displayName: string
  timeZone: string
  createdAt: string
}

// One listening server and one keep-alive agent per app, shared by every request of a test file.
// `request(app)` listens, connects and closes once per request: thousands of short-lived loopback
// connections per run. On Node 24.15 for Windows that churn aborts the process natively
// (exit 127 / 0xC0000409, no message) in about one full run in four; Node 22.14 never does. With
// a persistent server and keep-alive, a file opens a handful of connections instead.
const shared = new Map<Express, { server: Server; url: string; agent: Agent }>()

function sharedFor(app: Express) {
  const known = shared.get(app)
  if (known) return known
  // No host: a host-less listen binds synchronously, so the port is known right away.
  const server = app.listen(0)
  server.unref()
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  // Node's 5 s default would let the server close an idle reused socket between two requests.
  server.keepAliveTimeout = 60_000
  server.headersTimeout = 65_000
  const entry = { server, url, agent: new Agent({ keepAlive: true }) }
  shared.set(app, entry)
  return entry
}

/** Supertest bound to the shared server of `app`. Use it instead of `request(app)`. */
export function http(app: Express) {
  const { url, agent } = sharedFor(app)
  return {
    get: (path: string) => request(url).get(path).agent(agent),
    post: (path: string) => request(url).post(path).agent(agent),
    patch: (path: string) => request(url).patch(path).agent(agent),
    delete: (path: string) => request(url).delete(path).agent(agent)
  }
}

/** Closes the shared server and keep-alive connections of `app`. Safe to call twice. */
export async function stopServer(app: Express): Promise<void> {
  const known = shared.get(app)
  if (!known) return
  shared.delete(app)
  known.agent.destroy()
  known.server.closeAllConnections()
  await new Promise<void>((resolve) => known.server.close(() => resolve()))
}

export type Client = {
  get: (path: string) => Test
  post: (path: string) => Test
  patch: (path: string) => Test
  delete: (path: string) => Test
}

/** Supertest wrapper that sends the frontend `Origin` on state-changing requests by default. */
export function createClient(app: Express, config: Pick<Config, 'frontendUrl'>): Client {
  const origin = (test: Test) => test.set('Origin', config.frontendUrl)
  return {
    get: (path) => http(app).get(path),
    post: (path) => origin(http(app).post(path)),
    patch: (path) => origin(http(app).patch(path)),
    delete: (path) => origin(http(app).delete(path))
  }
}

let counter = 0

export function signUpBody(overrides: Record<string, unknown> = {}) {
  counter += 1
  return {
    email: `user${counter}-${Date.now()}@example.com`,
    password: 'correct-horse-battery',
    displayName: 'Test User',
    timeZone: 'Europe/Paris',
    ...overrides
  }
}

/** Extracts the `sid=<value>` pair from a response's Set-Cookie header. */
export function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const header = res.headers['set-cookie'] as string[] | undefined
  const sid = header?.find((value) => value.startsWith('sid='))
  if (!sid) throw new Error('response has no sid cookie')
  return sid.split(';')[0] as string
}

/** Signs up a user with a unique email and returns the user, the request body and the cookie. */
export async function signUp(client: Client, overrides: Record<string, unknown> = {}) {
  const body = signUpBody(overrides)
  const res = await client.post('/api/user').send(body)
  if (res.status !== 201) throw new Error(`signup failed with ${res.status}`)
  return { user: (res.body as { user: UserBody }).user, body, cookie: cookieFrom(res) }
}
