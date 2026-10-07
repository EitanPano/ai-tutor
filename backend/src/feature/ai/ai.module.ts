import { createAiService, type AiService, type AiServiceDeps } from './ai.service.js'

/** What other modules may call: every ai method (the module has no router). */
export type AiApi = AiService
export type AiModuleDeps = AiServiceDeps

export function createAiModule(deps: AiModuleDeps): { api: AiApi } {
  return { api: createAiService(deps) }
}
