import type { Config } from '../config.js'
import { createAnthropicProvider } from './anthropic.provider.js'
import { FakeTutorProvider } from './fake.provider.js'
import type { TutorProvider } from './tutor.js'

/** Picks the provider from config. Boot already refuses `fake` in production. */
export function createTutorProvider(
  config: Pick<Config, 'aiProvider' | 'aiModel' | 'anthropicApiKey' | 'aiFakeDelayMs'>
): TutorProvider {
  if (config.aiProvider === 'anthropic') {
    if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is required')
    return createAnthropicProvider({ apiKey: config.anthropicApiKey, model: config.aiModel })
  }
  return new FakeTutorProvider({ delayMs: config.aiFakeDelayMs })
}
