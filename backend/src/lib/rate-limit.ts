import { createHash } from 'node:crypto'
import type { Response } from 'express'
import { isIPv4, isIPv6 } from 'node:net'
import type pg from 'pg'
import { RateLimiterPostgres, RateLimiterRes } from 'rate-limiter-flexible'
import { tooManyRequests } from './error.js'

export const LOGIN_POINTS = 5
export const LOGIN_DURATION_SECONDS = 60

/**
 * Postgres-backed login limiter: 5 attempts per minute per ip + email.
 * `tableCreated: true` means the library never creates or alters tables; `rate_limit` is
 * created by migration 002-auth.sql.
 */
export function createLoginLimiter(pool: pg.Pool): RateLimiterPostgres {
  return createLimiter(pool, 'login', LOGIN_POINTS, LOGIN_DURATION_SECONDS)
}

/** Sign-ups per IP: `points` per hour. Runs before any hashing or database work. */
export function createSignupLimiter(pool: pg.Pool, points: number): RateLimiterPostgres {
  return createLimiter(pool, 'signup', points, 60 * 60)
}

/** Login attempts per IP (any email): `points` per 15 minutes. */
export function createLoginIpLimiter(pool: pg.Pool, points: number): RateLimiterPostgres {
  return createLimiter(pool, 'login-ip', points, 15 * 60)
}

function createLimiter(
  pool: pg.Pool,
  keyPrefix: string,
  points: number,
  duration: number
): RateLimiterPostgres {
  return new RateLimiterPostgres({
    storeClient: pool,
    storeType: 'pool',
    tableName: 'rate_limit',
    tableCreated: true,
    keyPrefix,
    points,
    duration
  })
}

/**
 * Consumes one point. On exhaustion sets `Retry-After` and throws 429 `rate_limited`.
 * Any other failure (a database error) propagates unchanged.
 */
export async function consumeOrThrow(
  limiter: RateLimiterPostgres,
  key: string,
  res: Response,
  message: string
): Promise<void> {
  try {
    await limiter.consume(key)
  } catch (err) {
    if (!(err instanceof RateLimiterRes)) throw err
    res.set('Retry-After', String(Math.max(1, Math.ceil(err.msBeforeNext / 1000))))
    throw tooManyRequests(message)
  }
}

/**
 * The key a per-IP limiter counts under: an IPv4 address (or IPv4-mapped IPv6 such as
 * `::ffff:1.2.3.4`) counts on its own; any other IPv6 address counts per /64, because one
 * subscriber typically holds a whole /64 and could otherwise rotate through 2^64 addresses.
 * Anything that is not an address is returned unchanged.
 */
export function ipLimitKey(ip: string): string {
  const address = ip.split('%')[0] ?? ip
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1]
  if (mapped && isIPv4(mapped)) return mapped
  if (isIPv4(address)) return address
  if (!isIPv6(address)) return ip
  const groups = expandIPv6(address).slice(0, 4)
  return `${groups.map((group) => group.toString(16)).join(':')}::/64`
}

/** The eight 16-bit groups of an IPv6 address (`::` expanded, a trailing dotted IPv4 converted). */
function expandIPv6(address: string): number[] {
  const toGroups = (part: string): number[] =>
    part === ''
      ? []
      : part.split(':').flatMap((token) => {
          if (!token.includes('.')) return [parseInt(token, 16)]
          const [a = 0, b = 0, c = 0, d = 0] = token.split('.').map(Number)
          return [a * 256 + b, c * 256 + d]
        })
  const [head = '', tail] = address.split('::')
  const start = toGroups(head)
  const end = tail === undefined ? [] : toGroups(tail)
  const fill = tail === undefined ? 0 : 8 - start.length - end.length
  return [...start, ...Array<number>(fill).fill(0), ...end]
}

/**
 * `${ip}:${normalised email}`. The email part is hashed so the key always fits the table's
 * varchar(255) (an email can be 254 chars and an IPv6 address 45) and no email is stored in
 * the rate_limit table. The IP part stays readable, like the per-IP keys (`ipLimitKey`): a
 * normalised address or /64 prefix is short-lived counter data (it expires with its window), and
 * readable keys let an operator see which address is being throttled.
 */
export function loginLimitKey(ip: string, email: string): string {
  const digest = createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
  return `${ip}:${digest}`
}
