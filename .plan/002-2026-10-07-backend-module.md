# 002 — Backend module structure

Status: done
Owner: Eitan
Last updated: 2026-10-07
Approval: design approved in chat on 2026-10-07 (four sections: layout, module contract, enforcement,
migration); execution directed by Eitan the same day.
Backlog task: `backend module structure | stack:full | plan:002` in `.plan/000-backlog.md`
Builds on: `001-2026-10-06-ai-tutor-mvp.md` (replaces its "Target architecture" backend layering; nothing else)

## Goal

Restructure `backend/src` from layers (`route/` → `service/` → `lib/`) into **feature modules** so the
codebase scales with more features and more contributors (people or agents):

- A new feature is one folder under `backend/src/feature/` plus one wiring line in `backend/src/app.ts`.
- Modules call each other only through an injected, hand-written `api`, never through another module's
  internals and never controller-to-controller.
- The boundaries are enforced by tooling (`dependency-cruiser` + an ownership test), not by discipline.

This is a pure refactor: no behaviour change, no API contract change.

## Scope

### In scope

**Target layout**

```
backend/src/
  index.ts              process: config, db, listen, boot recovery, shutdown
  app.ts                composition root: builds modules in dependency order, mounts routers
  feature/
    user/               owns app_user, session (user + session routes, requireSession)
    topic/              owns topic
    ai/                 owns ai_call, app_user.generation_started_at (no router)
    thread/             owns thread, message (thread routes + SSE message route, stale-turn recovery)
    guide/              owns guide, guide_step
    quiz/               owns quiz, quiz_item, quiz_attempt
    progress/           owns nothing; cross-table read model
    health/             liveness and readiness
  http/                 Express helpers with no domain: get-auth, path-id, origin-check, request-id,
                        auth-types.d.ts
  lib/                  infrastructure, unchanged, plus ownership.ts (moved from service/)
```

**Module shape**

```
feature/<name>/
  index.ts              the only file other code may import; exports createXModule + types only
  <name>.module.ts      createXModule(deps) → { api?, router? }; declares XApi and XModuleDeps
  <name>.service.ts     createXService(deps) → methods closing over deps
  <name>.route.ts       xRouter(service, deps) → Router; HTTP + Zod; no controller file
  <name>.schema.ts      Zod request schemas (moved out of the route file)
```

A module may hold more than one service or route file (for example `user/` holds `session.service.ts`
and `session.route.ts`; `thread/` holds `message.service.ts`, `message.route.ts`, `stale-turn.ts`).

**Module APIs (the public contracts)**

```ts
// feature/topic
type TopicApi = { require(id: string): Promise<TopicDto> }
createTopicModule({ db }): { api: TopicApi; router: Router }

// feature/ai
type AiApi = {
  assertEnabled(): void                                    // 503 ai_unavailable
  assertWithinBudget(auth: Auth): Promise<void>            // 429 ai_budget_exceeded
  recordCall(auth: Auth, row: AiCallRecord): Promise<void>
  acquireLock(auth: Auth): Promise<GenerationLockToken>    // 409 generation_in_progress
  releaseLock(auth: Auth, token: GenerationLockToken, tx?: Db): Promise<void>
  generateValidated<S extends z.ZodType>(auth: Auth, options: GenerateOptions<S>): Promise<z.output<S>>
  readonly lockTtlSeconds: number
}
createAiModule({ db, config, logger }): { api: AiApi }

// feature/user
createUserModule({ db, config, loginLimiter }): { router: Router; requireSession: RequestHandler }

// feature/thread
type ThreadSummary = { id: string; topicId: string; title: string; messageCount: number }
type ThreadApi = {
  require(auth: Auth, id: string): Promise<ThreadSummary>  // 404 not_found
  assertHasAnswer(auth: Auth, id: string): Promise<void>   // 409 thread_empty
  history(auth: Auth, id: string): Promise<TutorTurn[]>
  recoverStale(): Promise<number>                           // system-wide sweep, boot only
}
createThreadModule({ db, config, tutor, logger, inFlight, requireSession, topic, ai })
  : { api: ThreadApi; router: Router }

// feature/guide, feature/quiz
createGuideModule({ db, config, tutor, logger, requireSession, thread, topic, ai }): { router: Router }
createQuizModule({ db, config, tutor, logger, requireSession, thread, topic, ai }): { router: Router }

// feature/progress, feature/health
createProgressModule({ db, requireSession }): { router: Router }
createHealthModule({ db }): { router: Router }
```

`GenerateOptions<S>` is today's `generateValidated` options minus `logger` (the ai module's logger is used).
Only `releaseLock` takes `tx`: it is the one cross-module write that runs inside another module's
transaction (`finishAsk`). No other caller passes a transaction today, so no other method takes one.

**Composition root**

`createApp(deps)` returns `{ app: Express; modules: AppModules }` with
`AppModules = { ai: AiApi; topic: TopicApi; thread: ThreadApi }` — the APIs that code outside the HTTP
layer needs (boot recovery in `index.ts`, and tests). Modules are built in this order:
`user`, `topic`, `ai`, `thread`, `guide`, `quiz`, `progress`, `health`. `const` ordering makes a wiring
cycle a TypeScript error.

**Contract rules**

1. `XApi` types are hand-written in `x.module.ts`, never `ReturnType<…>`.
2. `auth` is an explicit first argument on every per-user method; services are singletons and never hold
   request state.
3. Factories do cheap synchronous setup only (`createUserModule` calls `warmDummyHash()`); no I/O.
4. Errors are unchanged: services throw `AppError`, cross-module errors propagate as-is, `errorMiddleware`
   formats them.
5. Write ownership: a table is written only by the module that owns it (table above). Reads across modules
   through SQL joins are allowed (thread detail, guide ownership join, progress).

**Enforcement**

- `dependency-cruiser` in `bun run lint` (backend), rules:
  1. `cross-module-type-only` — `src/feature/A` may import `src/feature/B` only as `import type`.
  2. `module-public-api-only` — anything outside `src/feature/X/` imports only `src/feature/X/index.ts`.
  3. `infra-is-leaf` — `src/lib/**` and `src/http/**` never import `src/feature/**` or `src/app.ts`.
  4. `no-circular` — anywhere in `src/`.
  5. `index-exports` — covered by review plus rule 2 (an `index.ts` re-exports only `createXModule` and
     types; a value re-export would be caught by rule 1 at the import site).
- `tests/unit/architecture.test.ts` — `OWNED` map (module → tables it may write) is the single source of
  truth; the test scans `src/feature/<m>/**/*.ts` for Kysely `insertInto/updateTable/deleteFrom('<t>')` and
  raw `INSERT INTO / UPDATE / DELETE FROM <t>`, failing when `<t>` is not owned by `<m>`.

**Docs updated in this branch:** `AGENTS.md` (backend layout line), `.doc/architecture.md` (modules,
dependency graph, data rule, change log), `.claude/agents/backend.md` (Step 2 structure and module rules).

### Out of scope

- Any behaviour change and any `.orchestrate/api-contract.yaml` change.
- Multi-instance readiness (configurable pool size, global AI concurrency cap, readiness during shutdown):
  a separate plan, sub-project B.
- Moving prompts and draft schemas out of `lib/tutor/` (would change the `TutorProvider` interface).
- Moving tests next to their modules; an in-process event bus; a DI container or framework.
- Editing plan `001` (a record of its decisions).

## Assumptions

- A1. One deployable stays one deployable: Express 5, Kysely, Zod, pino, Vitest are unchanged.
- A2. The existing suites are the safety net: backend 346 tests and frontend 208 tests passed at `6dabb19`.
- A3. The frontend is untouched; it talks to the backend only through the HTTP contract.
- A4. Branch `chore/backend-module` is stacked on `feat/ai-tutor-mvp` (PR #4). That PR merges with a merge
  commit, so this branch needs no rebase afterwards.
- A5. Tests may import module internals (the boundary rules apply to `src/` only). Where a test calls a
  service directly, it builds that service from real module APIs (`ctx.modules`), not fakes.

## Open Questions

All answered in chat on 2026-10-07.

**Q1 — Which kind of scale?** **Answered: both.** Split into this plan (codebase scale) and a later plan
(runtime scale, sub-project B), this one first so B lands in the final module layout.

**Q2 — How do modules call each other?** **Answered: module factories with explicit dependency
injection** (`createXModule(deps)`, wired in `app.ts`). Rejected: folders + barrel only (no swappable
dependencies, cycles possible); NestJS (rewrite, decorator magic). Controller-to-controller calls rejected:
controllers are HTTP adapters (response ownership, double auth/validation, SSE cannot compose).

**Q3 — Boundary tooling?** **Answered: `dependency-cruiser`**, with ESLint `no-restricted-imports`
(`allowTypeImports`) as the fallback if it cannot parse TypeScript 6 (checked in step 1).

**Q4 — Branch?** **Answered:** MVP pushed and opened as PR #4 for Eitan to merge; this branch is stacked on
it. Commits per step are approved; nothing is pushed without asking.

## Steps

Every step ends with `bun run typecheck`, `bun run lint` and `bun run test` green in `backend/`, then one
commit (Conventional Commits).

### Phase 1 — Moves, no signature changes

1. **Tooling.** Add `dependency-cruiser` (dev dependency, `bun add -d`) and `backend/.dependency-cruiser.cjs`
   with rules 3 (`infra-is-leaf`) and 4 (`no-circular`) on; rules 1–2 are written but on in step 11. Wire
   `depcruise src` into the backend `lint` script. Verify it resolves TypeScript 6 sources (a deliberate
   cycle must fail). The architecture test lands in step 2, once `feature/` exists.
   Commit: `build(backend): add dependency-cruiser`.
2. **Move files.** `git mv` every route and service into its module folder, middleware helpers into
   `http/`, `ownership.ts` into `lib/`; extract `requestId` from `app.ts` into `http/request-id.ts`; split
   Zod request schemas into `*.schema.ts`; add `index.ts` per module re-exporting today's functions; fix
   all imports (including `tests/`). Add `tests/unit/architecture.test.ts`. Signatures unchanged.
   Commit: `refactor(backend): move routes and services into feature modules`.

### Phase 2 — Module factories, one module per commit, in dependency order

3. **`topic`.** `createTopicService({ db })`, `createTopicModule`; consumers (`thread`, `message`, `guide`,
   `quiz` services) receive `topic: TopicApi` through their existing deps and routers.
   `createApp` starts returning `{ app, modules }`; `tests/helper/app.ts` exposes `modules`.
4. **`ai`.** One module from `ai-guard`, `ai-budget`, `generation-lock`, `generate-validated`.
   `config.aiDailyTokenBudget` moves inside `assertWithinBudget`; `logger` inside `generateValidated`.
   Consumers switch to `deps.ai.*`; `stale-turn` reads `ai.lockTtlSeconds`.
5. **`user`.** `createUserModule({ db, config, loginLimiter })` returns one router (user + session routes)
   and `requireSession`. `warmDummyHash()` moves from `app.ts` into the factory. Every protected router
   receives `requireSession` as a dependency instead of building it from `(db, config)`.
6. **`thread`.** Thread, message (ask) and stale-turn services become one module; `buildHistory` becomes
   `thread.history`; `index.ts` boots recovery through `modules.thread.recoverStale()`.
7. **`guide`.** Factory form; consumes `thread`, `topic`, `ai`.
8. **`quiz`.** Factory form; consumes `thread`, `topic`, `ai`.
9. **`progress` and `health`.** Factory form.
10. **Composition root cleanup.** `app.ts` builds all modules in order and mounts routers in one place.
11. **Enforce.** Turn on rules 1–2; fix anything they find.
12. **Docs.** `AGENTS.md`, `.doc/architecture.md`, `.claude/agents/backend.md`, backlog line.

## Validation

Each item is provable by a command or test:

- V1. `cd backend && bun run typecheck` exits 0.
- V2. `cd backend && bun run lint` exits 0, and its output includes a `dependency-cruiser` run with
  0 violations.
- V3. `cd backend && bun run test` passes with at least 346 tests (346 existing + the architecture test).
- V4. `git diff 6dabb19 -- backend/tests` changes only imports, how a service is reached
  (`fn(ctx.db, auth, …)` → `service.fn(auth, …)` / `ctx.modules.*`) and `tests/helper/app.ts`. No matcher,
  expected value, test name or test case is added, removed or changed (reviewed on the final diff).
- V5. `git diff 6dabb19 -- .orchestrate/api-contract.yaml frontend` is empty.
- V6. `backend/src/route/` and `backend/src/service/` no longer exist.
- V7. A deliberate violation fails lint: importing `../thread/thread.service.js` from `feature/quiz/` as a
  value fails `cross-module-type-only` (checked once in step 11, not committed).
- V8. A deliberate write to `quiz` from `feature/guide/` fails `architecture.test.ts` (checked once in
  step 11, not committed).
- V9. From the repo root, `bun run typecheck`, `bun run lint` and `bun run test` pass (frontend unaffected).

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A large diff hides a regression | High | Phase 1 is moves only; phase 2 is one module per commit; the integration suite runs through `createApp` after every step |
| `releaseLock(tx)` dropped inside `finishAsk` | High: lock leaks or non-atomic turn | Keep `tx` explicit; ask and generation-lock integration tests cover success, error, refusal and abort |
| `dependency-cruiser` cannot parse TypeScript 6 | Medium | Verified in step 1 before anything depends on it; ESLint fallback (Q3) |
| Merge conflicts with fixes landing on `feat/ai-tutor-mvp` | Medium | No backend changes on the MVP branch until this merges (A4) |
| The ownership test is a text scan | Low | Every write today uses a literal table name; column-level ownership (`ai` → `app_user.generation_started_at`) is enforced by review |

## Rollout Order

1. Steps 1–2 (phase 1) before any conversion.
2. Steps 3–9 strictly in dependency order: a module is converted only after every module it consumes.
3. Steps 10–12 last.
4. Merge only after PR #4 is merged, through its own GitHub pull request, with Eitan's approval.
5. Sub-project B (runtime scale) gets its own plan after this merges.

## Rollback

- Code only, no schema or data changes: revert the merge commit, or revert individual step commits
  (each is green on its own).
- `dependency-cruiser` is a dev dependency with no runtime effect; removing it is one commit.
