import { createHash } from 'node:crypto'
import path from 'node:path'

// Test databases are named `<base>_<suffix>`, where the suffix is the first 8 hex chars of the
// SHA-256 of the checkout's absolute path, so two checkouts never reset or drop each other's
// databases. frontend/tests/e2e/e2e-env.ts applies the same rule; keep the two in step.

/** The checkout root: this file is `<root>/backend/tests/helper/`. */
const CHECKOUT_ROOT = path.resolve(import.meta.dirname, '../../..')

export function checkoutSuffix(root: string = CHECKOUT_ROOT): string {
  return createHash('sha256').update(root).digest('hex').slice(0, 8)
}

export function testDatabaseName(base: string, root: string = CHECKOUT_ROOT): string {
  return `${base}_${checkoutSuffix(root)}`
}

export const TEST_DATABASE_NAME = testDatabaseName('ai_tutor_test')
export const SCHEMA_CHECK_DATABASE_NAME = testDatabaseName('ai_tutor_schema_check')
