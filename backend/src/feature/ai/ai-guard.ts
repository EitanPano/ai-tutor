import type { Config } from '../../lib/config.js'
import { serviceUnavailable } from '../../lib/error.js'

/** The AI_ENABLED kill switch: 503 `ai_unavailable` when AI features are turned off. */
export function assertAiEnabled(config: Pick<Config, 'aiEnabled'>): void {
  if (!config.aiEnabled) {
    throw serviceUnavailable('ai_unavailable', 'AI features are temporarily unavailable.')
  }
}
