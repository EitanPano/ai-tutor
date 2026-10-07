import { defineConfig, devices } from '@playwright/test'
import { E2E_BACKEND_ENV } from './tests/e2e/e2e-env'

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:3100', trace: 'on-first-retry', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'bun run --filter backend dev',
      cwd: '..',
      // The backend must not query the DB at boot: globalSetup resets the e2e DB after the
      // servers have started.
      // `/health` (not `/ready`): it must answer even if globalSetup has not created the database yet.
      url: 'http://localhost:4100/health',
      env: E2E_BACKEND_ENV,
      reuseExistingServer: false,
      timeout: 60_000
    },
    {
      command: 'bun run dev --port 3100',
      url: 'http://localhost:3100/login',
      env: { NEXT_PUBLIC_API_URL: 'http://localhost:4100', NEXT_DIST_DIR: '.next-e2e' },
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
})
