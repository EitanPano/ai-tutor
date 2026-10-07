import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    include: ['tests/**/*.test.ts'],
    // Threads, not forks: on Windows a forked worker intermittently dies at start-up
    // (exit code 3221226505) and fails the run.
    pool: 'threads',
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
