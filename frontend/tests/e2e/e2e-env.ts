import { createHash } from 'node:crypto'
import path from 'node:path'

// Same rule as backend/tests/helper/test-database-name.ts: the database name carries the first 8 hex
// chars of the SHA-256 of the checkout's absolute path, so two checkouts never share a database.
const CHECKOUT_ROOT = path.resolve(import.meta.dirname, '../../..')
const E2E_DATABASE = `ai_tutor_e2e_${createHash('sha256').update(CHECKOUT_ROOT).digest('hex').slice(0, 8)}`

/** Backend environment for the isolated e2e stack: ports 4100/3100 and a per-checkout database. */
export const E2E_BACKEND_ENV = {
  PORT: '4100',
  DATABASE_URL: `postgres://ai_tutor:ai_tutor@localhost:5432/${E2E_DATABASE}`,
  FRONTEND_URL: 'http://localhost:3100',
  AI_PROVIDER: 'fake',
  // Explicit: the budget specs spend 60000 tokens; the fake provider's default is far higher.
  AI_DAILY_TOKEN_BUDGET: '50000',
  // The specs sign up and log in many users from one address.
  SIGNUP_RATE_LIMIT: '100000',
  LOGIN_IP_RATE_LIMIT: '100000',
  NODE_ENV: 'development',
  LOG_LEVEL: 'warn',
  // The backend must not query at boot: globalSetup resets this database after it started.
  RECOVER_STALE_ON_BOOT: 'false'
}
