import { pino, type Logger } from 'pino'
import type { Config } from './config.js'

const REDACT_PATHS = [
  'password',
  'passwordHash',
  'token',
  'content',
  'apiKey',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.content',
  '*.apiKey',
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'headers.cookie',
  'headers.authorization',
  'headers["set-cookie"]'
]

export function createLogger(config: Pick<Config, 'nodeEnv' | 'logLevel'>): Logger {
  return pino({
    level: config.logLevel,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(config.nodeEnv === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {})
  })
}

export type { Logger }
