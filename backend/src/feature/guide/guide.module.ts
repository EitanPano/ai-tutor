import type { RequestHandler, Router } from 'express'
import { guideRouter } from './guide.route.js'
import { createGuideService, type GuideServiceDeps } from './guide.service.js'

export type GuideModuleDeps = GuideServiceDeps & { requireSession: RequestHandler }

export function createGuideModule(deps: GuideModuleDeps): { router: Router } {
  const { requireSession, ...serviceDeps } = deps
  const service = createGuideService(serviceDeps)
  return { router: guideRouter(service, { requireSession }) }
}
