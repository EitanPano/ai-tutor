import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    globalSetup: ['tests/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://ai_tutor:ai_tutor@localhost:5432/ai_tutor_test',
      LOG_LEVEL: 'silent',
      AI_FAKE_DELAY_MS: '0'
    }
  }
})
