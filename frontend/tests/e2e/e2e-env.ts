/** Backend environment for the isolated e2e stack: ports 4100/3100 and the `ai_tutor_e2e` database. */
export const E2E_BACKEND_ENV = {
  PORT: '4100',
  DATABASE_URL: 'postgres://ai_tutor:ai_tutor@localhost:5432/ai_tutor_e2e',
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
