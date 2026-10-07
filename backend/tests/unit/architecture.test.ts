import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Single source of truth for write ownership: module → tables it may write.
// `ai` writes only app_user.generation_started_at (column-level, enforced by review).
const OWNED: Record<string, readonly string[]> = {
  user: ['app_user', 'session'],
  topic: ['topic'],
  ai: ['ai_call', 'app_user'],
  thread: ['thread', 'message'],
  guide: ['guide', 'guide_step'],
  quiz: ['quiz', 'quiz_item', 'quiz_attempt'],
  progress: [],
  health: []
}

const FEATURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/feature')

const WRITE_PATTERNS: readonly RegExp[] = [
  /\.(?:insertInto|updateTable|deleteFrom)\(\s*['"]([a-z_][a-z0-9_]*)['"]/g,
  /\bINSERT INTO\s+([a-z_][a-z0-9_]*)/g,
  /(?<!FOR\s)(?<!DO\s)\bUPDATE\s+([a-z_][a-z0-9_]*)/g,
  /\bDELETE FROM\s+([a-z_][a-z0-9_]*)/g
]

type Write = { module: string; table: string; file: string }

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return tsFiles(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

function featureModules(): string[] {
  return readdirSync(FEATURE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function detectWrites(): Write[] {
  const writes: Write[] = []
  for (const module of featureModules()) {
    for (const file of tsFiles(path.join(FEATURE_ROOT, module))) {
      const source = readFileSync(file, 'utf8')
      for (const pattern of WRITE_PATTERNS) {
        for (const match of source.matchAll(pattern)) {
          const table = match[1]
          if (table) writes.push({ module, table, file: path.relative(FEATURE_ROOT, file) })
        }
      }
    }
  }
  return writes
}

describe('module write ownership', () => {
  it('declares an owned-table entry for every feature module', () => {
    const undeclared = featureModules().filter((module) => !(module in OWNED))
    expect(undeclared, `feature modules missing from OWNED: ${undeclared.join(', ')}`).toEqual([])
  })

  it('only lets a module write the tables it owns', () => {
    const violations = detectWrites()
      .filter(({ module, table }) => !OWNED[module]?.includes(table))
      .map(({ module, table, file }) => `${file}: module "${module}" writes table "${table}"`)
    expect(violations).toEqual([])
  })

  it('detects the known writes, so the scan is not vacuous', () => {
    const found = new Set(detectWrites().map(({ module, table }) => `${module}/${table}`))
    for (const pair of [
      'user/session',
      'ai/ai_call',
      'ai/app_user',
      'thread/message',
      'guide/guide_step',
      'quiz/quiz_attempt'
    ]) {
      expect(found.has(pair), `expected the scan to detect ${pair}`).toBe(true)
    }
  })
})
