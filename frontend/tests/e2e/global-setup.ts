import { execSync } from 'node:child_process'
import path from 'node:path'
import { E2E_BACKEND_ENV } from './e2e-env'

const repoRoot = path.resolve(import.meta.dirname, '../../..')

/**
 * Creates the per-checkout e2e database when missing, then drops and re-migrates it so every run
 * starts clean. Playwright may start the web servers before or after this runs; that is safe
 * because the backend never queries at boot and the servers are awaited on `/health`.
 */
export default function globalSetup(): void {
  const env = { ...process.env, ...E2E_BACKEND_ENV } as NodeJS.ProcessEnv
  for (const script of ['db:ensure', 'db:reset']) {
    execSync(`bun run --filter backend ${script}`, { cwd: repoRoot, env, stdio: 'inherit' })
  }
}
