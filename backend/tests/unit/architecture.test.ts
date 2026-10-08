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

// Tables two modules may write: app_user is shared at column level. `user` owns the account columns,
// `ai` writes only generation_started_at (column-level, enforced by review).
const SHARED: Record<string, readonly string[]> = { app_user: ['user', 'ai'] }

// Tables written by infrastructure in src/lib, not by any module.
const INFRA_TABLES: readonly string[] = ['rate_limit']

const SCHEMA_SQL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/schema.sql')

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

// Module roots: a module is one folder under src/api/ (HTTP modules) or src/services/ (no HTTP),
// named by its folder (OWNED is keyed by that name).
const MODULE_ROOTS: readonly string[] = ['api', 'services']

// Code outside the module roots that must write no table: it reaches data only through a module.
// lib/ is not listed: it holds the infra writes (INFRA_TABLES) and the seed and migration tooling.
const OUTSIDE_MODULES: readonly string[] = ['middleware', 'app.ts', 'context.ts', 'index.ts']

// Kysely: `.insertInto('t')`, `.updateTable('t as x')`, `.mergeInto(`t`)`; any quote style, alias dropped.
// Raw SQL: keywords match in any case and the table may be double-quoted. `FOR [NO KEY] UPDATE` and
// `DO UPDATE` are locks / upserts on a row already being written, not writes of their own.
const WRITE_PATTERNS: readonly RegExp[] = [
  /\.(?:insertInto|updateTable|deleteFrom|mergeInto)\(\s*(['"`])(?<table>[a-z_][a-z0-9_]*)(?:\s+as\s+[a-z_][a-z0-9_]*)?\1/gi,
  /\b(?:INSERT\s+INTO|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE(?:\s+TABLE)?)\s+"?(?<table>[a-z_][a-z0-9_]*)/gi,
  /(?<!\b(?:FOR|DO|KEY)\s+)\bUPDATE\s+"?(?<table>[a-z_][a-z0-9_]*)/gi
]

// Comments are prose ("update it when ..."), so they are removed before scanning.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

function scanWrites(source: string): string[] {
  const code = stripComments(source)
  return WRITE_PATTERNS.flatMap((pattern) =>
    [...code.matchAll(pattern)].flatMap((match) =>
      match.groups?.table ? [match.groups.table] : []
    )
  )
}

type Write = { module: string; table: string; file: string }

type Module = { name: string; dir: string }

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return tsFiles(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

function modules(): Module[] {
  return MODULE_ROOTS.flatMap((root) =>
    readdirSync(path.join(SRC, root), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, dir: path.join(SRC, root, entry.name) }))
  )
}

function detectWrites(): Write[] {
  const writes: Write[] = []
  for (const { name, dir } of modules()) {
    for (const file of tsFiles(dir)) {
      const source = readFileSync(file, 'utf8')
      for (const table of scanWrites(source)) {
        writes.push({ module: name, table, file: path.relative(SRC, file) })
      }
    }
  }
  return writes
}

function schemaTables(): string[] {
  const sql = readFileSync(SCHEMA_SQL, 'utf8')
  return [...sql.matchAll(/^CREATE TABLE\s+([a-z_][a-z0-9_]*)/gim)].flatMap((m) =>
    m[1] ? [m[1]] : []
  )
}

describe('module write ownership', () => {
  it('declares an owned-table entry for every module', () => {
    const undeclared = modules()
      .map(({ name }) => name)
      .filter((name) => !(name in OWNED))
    expect(undeclared, `modules missing from OWNED: ${undeclared.join(', ')}`).toEqual([])
  })

  it('keeps module folder names unique across the roots, since OWNED is keyed by name', () => {
    const names = modules().map(({ name }) => name)
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index)
    expect(duplicates).toEqual([])
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

  it('gives every table exactly one owning module, except the shared allowlist', () => {
    const problems: string[] = []
    for (const table of schemaTables()) {
      const owners = Object.entries(OWNED)
        .filter(([, tables]) => tables.includes(table))
        .map(([module]) => module)
      if (table in SHARED) {
        expect([...owners].sort(), `shared table ${table}`).toEqual([...SHARED[table]!].sort())
      } else if (INFRA_TABLES.includes(table)) {
        if (owners.length > 0) problems.push(`${table} is infra but owned by ${owners.join(', ')}`)
      } else if (owners.length !== 1) {
        problems.push(`${table} has ${owners.length} owners (${owners.join(', ')})`)
      }
    }
    expect(problems).toEqual([])
  })

  it.each(MODULE_ROOTS)('keeps src/%s free of loose files, which the scan would skip', (root) => {
    const loose = readdirSync(path.join(SRC, root), { withFileTypes: true })
      .filter((entry) => !entry.isDirectory())
      .map((entry) => entry.name)
    expect(loose).toEqual([])
  })

  it('keeps code outside the module roots from writing any table', () => {
    const violations = OUTSIDE_MODULES.flatMap((entry) => {
      const full = path.join(SRC, entry)
      const files = entry.endsWith('.ts') ? [full] : tsFiles(full)
      return files.flatMap((file) =>
        scanWrites(readFileSync(file, 'utf8')).map(
          (table) => `${path.relative(SRC, file)} writes table "${table}"`
        )
      )
    })
    expect(violations).toEqual([])
  })
})

describe('write scanner', () => {
  it.each([
    ['alias', `db.updateTable('quiz as q').set({})`, 'quiz'],
    ['backticks', 'db.insertInto(`quiz`).values({})', 'quiz'],
    ['mergeInto', `db.mergeInto('quiz').using()`, 'quiz'],
    ['lowercase update', 'await sql`update quiz set x = 1`', 'quiz'],
    ['quoted identifier', 'sql`DELETE FROM "quiz" WHERE true`', 'quiz'],
    ['truncate', 'sql`TRUNCATE TABLE quiz`', 'quiz'],
    ['lowercase insert', 'sql`insert into quiz (a) values (1)`', 'quiz']
  ])('detects %s', (_name, source, table) => {
    expect(scanWrites(source)).toEqual([table])
  })

  it.each([
    ['FOR UPDATE', 'sql`SELECT 1 FROM quiz FOR UPDATE`'],
    ['for no key update', 'sql`select 1 from quiz for no key update`'],
    ['DO UPDATE', 'sql`ON CONFLICT (id) DO UPDATE SET a = 1`'],
    ['a comment', '// update quiz when the draft changes']
  ])('does not treat %s as a write', (_name, source) => {
    expect(scanWrites(source)).toEqual([])
  })
})
