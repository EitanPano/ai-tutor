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

// Infrastructure: it holds the infra writes (INFRA_TABLES) and the seed and migration tooling, so it
// is the one entry of src/ besides the module roots that the outside-modules scan skips.
const INFRA_ROOT = 'lib'

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

/** The entry of src/ a file sits under: a top-level folder, or the file itself. */
function topEntry(file: string): string {
  const [top = ''] = path.relative(SRC, file).split(path.sep)
  return top
}

// Code outside the module roots and lib/ must write no table: it reaches data only through a module.
// Derived from src/ rather than listed, so a new top-level folder or file cannot go unscanned.
function filesOutsideModules(): string[] {
  return tsFiles(SRC).filter((file) => {
    const top = topEntry(file)
    return top !== INFRA_ROOT && !MODULE_ROOTS.includes(top)
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

  it('keeps code outside the module roots and lib/ from writing any table', () => {
    const files = filesOutsideModules()
    // Not vacuous: the derived set reaches the wiring and the middleware.
    expect(files.map(topEntry)).toEqual(
      expect.arrayContaining(['app.ts', 'context.ts', 'middleware'])
    )
    const violations = files.flatMap((file) =>
      scanWrites(readFileSync(file, 'utf8')).map(
        (table) => `${path.relative(SRC, file)} writes table "${table}"`
      )
    )
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

// The services a module's HTTP layer may read through `servicesOf(req)`: its own, named by its
// folder, unless listed here. `ai` is not an HTTP module, so no controller reads it.
const SERVICE_ACCESS: Record<string, readonly string[]> = {
  user: ['user', 'session'],
  thread: ['thread', 'message']
}

// Middleware may read only `session` (`requireSession`); it gets everything else from `ctxOf(req)`.
const MIDDLEWARE_SERVICES: readonly string[] = ['session']

const API_DIR = path.join(SRC, 'api')
const MIDDLEWARE_DIR = path.join(SRC, 'middleware')

// A use of `servicesOf(req)` or `ctxOf(req)` that is neither `.key` nor a destructuring: an alias,
// an index or a call. Never allowed, since the scan could not tell what it reads.
const UNREADABLE = '<unreadable>'

type Accessor = 'servicesOf' | 'ctxOf'

/** The keys read from `accessor(req)`, as `accessor(req).key` or `const { a, b: c } = accessor(req)`. */
function scanReads(source: string, accessor: Accessor): string[] {
  const use = new RegExp(
    String.raw`(?:\{(?<pattern>[^{}]*)\}\s*=\s*)?\b${accessor}\([^()]*\)(?:\s*\.\s*(?<key>\w+))?`,
    'g'
  )
  return [...stripComments(source).matchAll(use)].flatMap(({ groups }) => {
    const pattern = groups?.pattern
    const key = groups?.key
    if (pattern === undefined && key !== undefined) return [key]
    if (pattern !== undefined && key === undefined) {
      return pattern
        .split(',')
        .map((part) => part.split(':')[0]!.trim())
        .filter((part) => part !== '')
    }
    return [UNREADABLE]
  })
}

type Read = { reader: string; key: string; file: string }

/** Every read through `accessor`: under src/api/<m>/ by module `<m>`, under src/middleware/ by `middleware`. */
function detectReads(accessor: Accessor): Read[] {
  const readers = [
    ...readdirSync(API_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ reader: entry.name, files: tsFiles(path.join(API_DIR, entry.name)) })),
    { reader: 'middleware', files: tsFiles(MIDDLEWARE_DIR) }
  ]
  return readers.flatMap(({ reader, files }) =>
    files.flatMap((file) =>
      scanReads(readFileSync(file, 'utf8'), accessor).map((key) => ({
        reader,
        key,
        file: path.relative(SRC, file)
      }))
    )
  )
}

function allowedServices(reader: string): readonly string[] {
  if (reader === 'middleware') return MIDDLEWARE_SERVICES
  return SERVICE_ACCESS[reader] ?? [reader]
}

describe('service access', () => {
  it('lets a module read only its own services, and middleware only the session service', () => {
    const violations = detectReads('servicesOf')
      .filter(({ reader, key }) => !allowedServices(reader).includes(key))
      .map(({ reader, key, file }) => `${file}: "${reader}" reads servicesOf(req) key "${key}"`)
    expect(violations).toEqual([])
  })

  it('never reaches the services through ctxOf(req)', () => {
    const violations = detectReads('ctxOf')
      .filter(({ key }) => key === 'services' || key === UNREADABLE)
      .map(({ key, file }) => `${file}: reads ctxOf(req) key "${key}"`)
    expect(violations).toEqual([])
  })

  it('detects the known reads, so the scan is not vacuous', () => {
    const found = new Set(
      [...detectReads('servicesOf'), ...detectReads('ctxOf')].map(
        ({ reader, key }) => `${reader}/${key}`
      )
    )
    for (const pair of [
      'guide/guide',
      'health/health',
      'thread/message',
      'user/session',
      'middleware/session',
      'thread/inFlight',
      'user/config',
      'middleware/limiters'
    ]) {
      expect(found.has(pair), `expected the scan to detect ${pair}`).toBe(true)
    }
  })
})

describe('read scanner', () => {
  it.each([
    ['a property', 'await servicesOf(req).quiz.get(auth, id)', ['quiz']],
    ['a destructuring', 'const { thread, message: m } = servicesOf(req)', ['thread', 'message']],
    ['a rest element', 'const { ...all } = servicesOf(req)', ['...all']],
    ['an alias', 'const services = servicesOf(req)', [UNREADABLE]],
    ['an index', "servicesOf(req)['ai']", [UNREADABLE]]
  ])('reads %s', (_name, source, keys) => {
    expect(scanReads(source, 'servicesOf')).toEqual(keys)
  })
})

// A route line: `router.verb('/path', ...middleware, handler)`, possibly wrapped. Middleware are
// named constants, so the arguments hold no parentheses.
const ROUTE = /\brouter\.(?<verb>\w+)\(\s*(['"`])(?<path>[^'"`\n]*)\2\s*,(?<args>[^)]*)\)/g
const ROUTER_CALL = /\brouter\.\w+\(/g
// `const validateX = validate({ params: a, body: b })`: the request parts it parses.
const VALIDATOR = /\bconst\s+(?<name>validate\w+)\s*=\s*validate\(\s*\{(?<spec>[^{}]*)\}\s*\)/g
// `export const name: Handler<Params, Body, Query> = ...`: the request parts the handler types.
const HANDLER = /\bexport\s+const\s+(?<name>\w+)\s*:\s*Handler(?:<(?<types>[^<>]*)>)?\s*=/g

type Part = 'params' | 'body' | 'query'

/**
 * The parts a route must validate: params when its path has a `:param` (or the handler types its
 * params), the body and query when the handler types them. Express infers these types from the
 * handler, so a route that forgets its `validateX` still compiles.
 */
function requiredParts(routePath: string, handlerTypes: readonly string[]): Part[] {
  const [params = 'ParamsDictionary', body = 'unknown', query] = handlerTypes
  const parts: Part[] = []
  if (/:\w/.test(routePath) || params !== 'ParamsDictionary') parts.push('params')
  if (body !== 'unknown') parts.push('body')
  if (query !== undefined) parts.push('query')
  return parts
}

/** `name` → the comma-separated keys in group `list` of each match (`a: x, b` → `a`, `b`). */
function namedLists(source: string, pattern: RegExp, list: string): Map<string, string[]> {
  return new Map(
    [...source.matchAll(pattern)].map(({ groups }) => [
      groups?.name ?? '',
      (groups?.[list] ?? '')
        .split(',')
        .map((part) => part.split(':')[0]!.trim())
        .filter((part) => part !== '')
    ])
  )
}

type RouteCheck = { checked: string[]; problems: string[] }

/** Checks every route of one route.ts against the handlers of its controller.ts. */
function checkRouteFile(routeSource: string, controllerSource: string): RouteCheck {
  const routes = stripComments(routeSource)
  const validators = namedLists(routes, VALIDATOR, 'spec')
  const handlers = namedLists(stripComments(controllerSource), HANDLER, 'types')
  const checked: string[] = []
  const problems: string[] = []
  const lines = [...routes.matchAll(ROUTE)]
  const unread = [...routes.matchAll(ROUTER_CALL)].length - lines.length
  if (unread > 0) problems.push(`${unread} router call(s) the scan cannot read`)
  for (const { groups } of lines) {
    const routePath = groups?.path ?? ''
    const route = `${(groups?.verb ?? '').toUpperCase()} ${routePath}`
    const args = (groups?.args ?? '')
      .split(',')
      .map((arg) => arg.trim())
      .filter((arg) => arg !== '')
    const handler = args.at(-1) ?? ''
    const handlerTypes = handlers.get(handler)
    if (handlerTypes === undefined) {
      problems.push(`${route}: "${handler}" is not an exported Handler of controller.ts`)
      continue
    }
    const covered = new Set(args.flatMap((arg) => validators.get(arg) ?? []))
    const missing = requiredParts(routePath, handlerTypes).filter((part) => !covered.has(part))
    if (missing.length > 0) problems.push(`${route}: no validateX parses its ${missing.join(', ')}`)
    checked.push(route)
  }
  return { checked, problems }
}

function checkRoutes(): RouteCheck {
  const checks = readdirSync(API_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(API_DIR, entry.name)
      const { checked, problems } = checkRouteFile(
        readFileSync(path.join(dir, 'route.ts'), 'utf8'),
        readFileSync(path.join(dir, 'controller.ts'), 'utf8')
      )
      return { checked, problems: problems.map((problem) => `api/${entry.name}: ${problem}`) }
    })
  return {
    checked: checks.flatMap(({ checked }) => checked),
    problems: checks.flatMap(({ problems }) => problems)
  }
}

describe('route validation', () => {
  it('validates the params, body and query of every route that takes them', () => {
    expect(checkRoutes().problems).toEqual([])
  })

  it('checks the known routes, so the scan is not vacuous', () => {
    const { checked } = checkRoutes()
    // One entry per route line; 22 when this test was written.
    expect(checked.length).toBeGreaterThanOrEqual(22)
    expect(checked).toEqual(
      expect.arrayContaining([
        'GET /api/thread',
        'PATCH /api/thread/:id',
        'POST /api/thread/:id/guide',
        'POST /api/session',
        'DELETE /api/session',
        'GET /health'
      ])
    )
  })
})

describe('route scanner', () => {
  const controller = [
    'export const get: Handler<IdParams> = async () => {}',
    'export const create: Handler<ParamsDictionary, CreateBody> = async () => {}',
    'export const list: Handler<ParamsDictionary, unknown, ListQuery> = async () => {}',
    'export const me: Handler = async () => {}'
  ].join('\n')
  const validators = [
    'const validateId = validate({ params: idParams })',
    'const validateCreate = validate({ body: createBody })'
  ].join('\n')

  it.each([
    ['a :param path without validateX', `router.get('/x/:id', requireSession, get)`, 'params'],
    ['a typed body without validateX', `router.post('/x', create)`, 'body'],
    ['a typed query without validateX', `router.get('/x', list)`, 'query'],
    ['a validateX of the wrong part', `router.get('/x/:id', validateCreate, get)`, 'params']
  ])('reports %s', (_name, line, part) => {
    const { problems } = checkRouteFile(`${validators}\n${line}`, controller)
    expect(problems).toEqual([expect.stringContaining(`no validateX parses its ${part}`)])
  })

  it.each([
    ['a validated :param path', `router.post('/x/:id/go', requireSession, validateId, get)`],
    ['a validated body', `router.post('/x', validateCreate, create)`],
    ['a route that takes nothing', `router.delete('/x', requireSession, me)`]
  ])('accepts %s', (_name, line) => {
    expect(checkRouteFile(`${validators}\n${line}`, controller)).toEqual({
      checked: [expect.any(String)],
      problems: []
    })
  })

  it('reports a handler it cannot find and a router call it cannot read', () => {
    const { problems } = checkRouteFile(`router.get('/x', missing)\nrouter.route('/y')`, controller)
    expect(problems).toEqual([
      '1 router call(s) the scan cannot read',
      'GET /x: "missing" is not an exported Handler of controller.ts'
    ])
  })
})
