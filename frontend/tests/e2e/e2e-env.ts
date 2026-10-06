/** Backend environment for the isolated e2e stack: ports 4100/3100 and the `ai_tutor_e2e` database. */
export const E2E_BACKEND_ENV = {
  PORT: '4100',
  DATABASE_URL: 'postgres://ai_tutor:ai_tutor@localhost:5432/ai_tutor_e2e',
  FRONTEND_URL: 'http://localhost:3100',
  AI_PROVIDER: 'fake',
  NODE_ENV: 'development',
  LOG_LEVEL: 'warn'
}
