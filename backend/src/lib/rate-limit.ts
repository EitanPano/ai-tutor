import { createHash } from 'node:crypto'
import type pg from 'pg'
import { RateLimiterPostgres } from 'rate-limiter-flexible'

export const LOGIN_POINTS = 5
export const LOGIN_DURATION_SECONDS = 60

/**
 * Postgres-backed login limiter: 5 attempts per minute per ip + email.
 * `tableCreated: true` means the library never creates or alters tables; `rate_limit` is
 * created by migration 002-auth.sql.
 */
export function createLoginLimiter(pool: pg.Pool): RateLimiterPostgres {
  return new RateLimiterPostgres({
    storeClient: pool,
    storeType: 'pool',
    tableName: 'rate_limit',
    tableCreated: true,
    keyPrefix: 'login',
    points: LOGIN_POINTS,
    duration: LOGIN_DURATION_SECONDS
  })
}

/**
 * `${ip}:${normalised email}`. The email part is hashed so the key always fits the table's
 * varchar(255) (an email can be 254 chars and an IPv6 address 45) and no address is stored
 * in the rate_limit table.
 */
export function loginLimitKey(ip: string, email: string): string {
  const digest = createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
  return `${ip}:${digest}`
}
