import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    // Threads, not forks: a forked worker died at start-up more often (exit code 3221226505).
    // The root `test` script runs the two workspaces one after the other; run them in parallel
    // and CPU pressure makes the abort below more likely.
    //
    // Known abort: Node 24.15.0 on Windows sometimes ends the whole process silently (exit 127
    // via bunx, 9 via bun run, 0xC0000409, no message) while a suite makes many loopback
    // connections. Node 22.14.0 never did in 20 runs; 24.15.0 did in about 1 run in 4. What
    // reduced it to 0 in 40: tests/helper/client.ts keeps one server and keep-alive connection per
    // app instead of a listen/connect/close per request, the DB URLs name 127.0.0.1 instead of
    // localhost (no failed ::1 attempt first), and integration files share one worker (below).
    pool: 'threads',
    fileParallelism: false,
    globalSetup: ['tests/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://ai_tutor:ai_tutor@127.0.0.1:5432/ai_tutor_test',
      LOG_LEVEL: 'silent',
      // Explicit: budget tests (AC09) depend on it, not on the provider-specific default.
      AI_DAILY_TOKEN_BUDGET: '50000',
      AI_FAKE_DELAY_MS: '0',
      // Suites sign up and log in many users from one address; the limit tests set small ones.
      SIGNUP_RATE_LIMIT: '100000',
      LOGIN_IP_RATE_LIMIT: '100000'
    },
    projects: [
      // Unit tests keep a fresh module graph per file (some assert on module-level state).
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      // Integration files share one worker: each builds its own app and pool and truncates the
      // tables it uses, so nothing needs a fresh module graph, and 19 worker teardowns go away.
      {
        extends: true,
        test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], isolate: false }
      }
    ]
  }
})
