import { ctxOf } from '../context.js'
import { assertAiEnabled } from '../lib/ai-enabled.js'
import type { Middleware } from './validate.js'

/** The AI_ENABLED kill switch as a route step: 503 `ai_unavailable` when AI features are off. */
export const requireAiEnabled: Middleware = (req, _res, next) => {
  assertAiEnabled(ctxOf(req).config)
  next()
}
