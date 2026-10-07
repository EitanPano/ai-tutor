import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    include: ['tests/**/*.test.ts'],
    // Threads, not forks: on Windows a forked worker intermittently dies at start-up
    // (exit code 3221226505) and fails the run. The forks abort was measured: about 1 in 14
    // runs on an older commit, about 2 in 6 on later ones. The earlier "threads is worse"
    // result only happened when the backend and frontend suites ran at the same time. The root
    // `test` script runs the two suites sequentially; they must not be run in parallel.
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
