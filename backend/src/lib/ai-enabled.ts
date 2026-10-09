import type { Config } from './config.js'
import { ERROR_MESSAGE, serviceUnavailable } from './error.js'

/** The AI_ENABLED kill switch: 503 `ai_unavailable` when AI features are turned off. */
export function assertAiEnabled(config: Pick<Config, 'isAiEnabled'>): void {
  if (!config.isAiEnabled) {
    throw serviceUnavailable('ai_unavailable', ERROR_MESSAGE.ai_unavailable)
  }
}
