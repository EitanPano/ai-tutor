import type { RequestHandler, Router } from 'express'
import type { Db } from '../../lib/db/index.js'
import { progressRouter } from './progress.route.js'
import { createProgressService } from './progress.service.js'

export type ProgressModuleDeps = { db: Db; requireSession: RequestHandler }

export function createProgressModule(deps: ProgressModuleDeps): { router: Router } {
  const service = createProgressService(deps)
  return { router: progressRouter(service, deps) }
}
