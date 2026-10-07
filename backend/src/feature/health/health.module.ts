import type { Router } from 'express'
import type { Db } from '../../lib/db/index.js'
import { healthRouter } from './health.route.js'

export type HealthModuleDeps = { db: Db }

export function createHealthModule(deps: HealthModuleDeps): { router: Router } {
  return { router: healthRouter(deps.db) }
}
