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
    get: (path) => request(app).get(path),
    post: (path) => origin(request(app).post(path)),
    patch: (path) => origin(request(app).patch(path)),
    delete: (path) => origin(request(app).delete(path))
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
