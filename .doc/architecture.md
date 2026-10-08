# System Architecture

## Purpose
- Provide a concise architecture reference for service boundaries, ownership, and major flows.

## Primary Components
- Browser — talks only to `frontend/` and `backend/`, never to Anthropic.
- `frontend/` — Next.js 16 (App Router) on :3000. Client components with TanStack Query and a typed client in
  `frontend/src/lib/api/`. `frontend/src/proxy.ts` redirects to `/login` when the `sid` cookie is missing; this is
  UX only, the backend is the authority on auth.
- `backend/` — Express 5 API on :4000, split into modules (see Backend Modules):
  - `src/api/<m>/` — one HTTP module per domain: `route.ts` (the route table), `controller.ts` (reads the request,
    calls the service, shapes the response), `service.ts` (domain rules and ownership; `auth: { userId }` is passed
    explicitly), `validation.ts` (Zod request schemas) and `index.ts` (router, service factory and types).
  - `src/services/<s>/` — domain services with no HTTP: `ai` (kill switch, budgets, `ai_call` ledger, generation
    lock, validated generation).
  - `src/middleware/` — Express middleware: `requireSession`, `validate`, rate limits, `requireAiEnabled`, request
    id, origin check, the 404 and error handlers.
  - `src/lib/` — infrastructure: db (Kysely), tutor provider, rate-limit stores, SSE, config, logger. It imports
    nothing else under `src/`.
  - `src/context.ts` — the per-app context (`AppContext`) and its per-request accessors `ctxOf` / `servicesOf`.
  - `src/app.ts` — composition root: builds the services in dependency order, attaches the context and mounts the
    routers.
- Postgres 18 — run locally through `compose.yaml`.
- Anthropic Messages API — called from the backend only (server-side).

## Backend Modules

```
backend/src/
  index.ts  app.ts  context.ts  types/express.d.ts
  api/<m>/      route.ts  controller.ts  service.ts  validation.ts  index.ts
  services/ai/  service.ts  budget.ts  generate-validated.ts  generation-lock.ts  index.ts
  middleware/   auth.ts  validate.ts  rate-limit.ts  require-ai-enabled.ts  request-id.ts  origin-check.ts  error.ts
  lib/          config, cookie, db/, error, sse, tutor/, validation, ...
```

- A second file of one role gets a sub-resource prefix: `user/session.service.ts`, `thread/message.service.ts`.
  A module that takes no input (`health`, `topic`, `progress`) has no `validation.ts`.
- `route.ts` is a declarative table: imports, `validateX` and limiter constants, one `router.verb(...)` line per route,
  `export default router`. A controller calls its service and shapes the HTTP response (the SSE `ask` handler also
  drives the stream); it holds no SQL and no domain branching. The service holds the rules.

Per-app context (`backend/src/context.ts`):
- `createApp` builds the services in dependency order and puts them, with config, db, logger, tutor provider,
  in-flight registry and rate limiters, into one `AppContext`. `attachContext` stores it on `app.locals` before any
  router is mounted.
- Routers and controllers are module-level singletons. Controllers and middleware read their dependencies per
  request: services through `servicesOf(req)`, everything else through `ctxOf(req)` (`requireSession` looks up the
  `session` service, the rate limiters read `ctx.limiters`). `ctxOf` throws when the app has no context.
- Why: integration tests keep several apps with different config alive in one Vitest worker, so nothing may capture
  a service, config value or limiter at import time. `Express.Locals` is not augmented (that would also type
  `res.locals.ctx`).

| Module | Owns (tables it writes) | Public types | Depends on |
|---|---|---|---|
| `api/user` | `app_user`, `session` | `UserService`, `SessionService` | — |
| `api/topic` | `topic` | `TopicService`, `TopicApi` | — |
| `services/ai` | `ai_call`, `app_user` (`generation_started_at` only) | `AiService`, `AiApi`, `GenerationLockToken` | — |
| `api/thread` | `thread`, `message` | `ThreadService`, `ThreadApi`, `MessageService` | `TopicApi`, `AiApi` |
| `api/guide` | `guide`, `guide_step` | `GuideService` | `TopicApi`, `AiApi`, `ThreadApi` |
| `api/quiz` | `quiz`, `quiz_item`, `quiz_attempt` | `QuizService` | `TopicApi`, `AiApi`, `ThreadApi` |
| `api/progress` | none (read-only) | `ProgressService` | — |
| `api/health` | none | `HealthService` | — |

Each `api/<m>/index.ts` also exports its router (`xRouter`) and service factory (`createXService`) for `app.ts`;
`services/ai` exports `createAiService` and has no router. `user` adds `createSessionService` and `warmDummyHash`,
`thread` adds `createMessageService`. Protected routes put `requireSession` (`src/middleware/auth.ts`) first.

Narrow cross-module types: a module receives another module's service typed as that module's API, so it can call
only what the API names.
- `TopicApi = Pick<TopicService, 'require'>`
- `ThreadApi = Pick<ThreadService, 'require' | 'assertHasAnswer' | 'history'>`
- `AiApi = Omit<AiService, 'releaseAllLocks'>`: `assertEnabled`, `assertWithinBudget`, `recordCall`, `acquireLock`,
  `releaseLock`, `withGenerationLock`, `generateValidated`, `lockTtlSeconds`

Boot recovery is in neither `ThreadApi` nor `AiApi` (it is a system-wide sweep, so guide and quiz must not hold it).
`createApp` returns `recoverAtBoot()`: `thread.recoverStaleAtBoot()`, then `ai.releaseAllLocks()` in a `finally`, so
a failed sweep never leaves users locked out. `src/index.ts` awaits it before listening (see Boot recovery).

Dependency order: `user`, `session`, `topic`, `ai` → `thread` → `message`, `guide`, `quiz`; `progress` and `health`
are standalone.

Rules:
- Modules call each other only through an injected API. Across modules only `import type` from the other module's
  `index.ts` is allowed; values are injected in `src/app.ts`.
- `auth` is an explicit first argument of every service method that acts for a user.
- A table is written only by its owner. Cross-module reads through SQL joins are allowed (thread detail, the guide
  ownership join, progress).
- `ai.releaseLock(…, tx)` is the one cross-module write inside another module's transaction.

Enforcement:
- dependency-cruiser (`backend/.dependency-cruiser.cjs`, run by `bun run lint`); a module is one folder under
  `src/api/` or `src/services/`:
  - `no-circular` — no import cycles; a cycle through a type-only import is erased at runtime and does not count.
  - `lib-is-leaf` — `src/lib/` imports nothing else under `src/`.
  - `middleware-values-from-lib-or-context` — middleware imports values only from `src/middleware/`, `src/lib/` and
    `src/context.ts`; it reads services per request through `ctxOf(req)`.
  - `context-types-only-from-modules` — `src/context.ts` imports modules as types only.
  - `not-to-unresolvable` — every import must resolve.
  - `cross-module-type-only` — a module imports another module only with type-only imports.
  - `module-public-api-only` — a module reaches another only through its `index.ts`.
  - `module-values-own-or-infra` — a module imports values only from itself, `src/lib/`, `src/middleware/` and
    `src/context.ts`, so a re-export from a new folder or top-level file cannot launder another module's values.
  - `services-have-no-middleware` — a service under `src/services/` imports no values from `src/middleware/`.
  - `outside-uses-public-api` — code outside the module roots (`app.ts`, `context.ts`, `middleware/`) reaches a
    module only through its `index.ts`.
  - `index-imports-own-folder-only` — an `index.ts` imports only from its own folder.
- ESLint `@typescript-eslint/no-import-type-side-effects` — type imports are written `import type { X }`, never
  `import { type X }`: with `verbatimModuleSyntax` the inline form leaves a runtime import behind, which dependency-cruiser
  would report as type-only.
- `OWNED` in `backend/tests/unit/architecture.test.ts` is the source of truth for write ownership, keyed by module
  folder name across `MODULE_ROOTS` (`api`, `services`). The test fails when a module has no `OWNED` entry, when two
  roots hold a folder of the same name, when a module writes a table it does not own, when a table in
  `db/schema.sql` has no single owner (the `SHARED` allowlist covers `app_user`; `rate_limit` is written by
  `src/lib/`), when `src/api/` or `src/services/` holds a loose file, and when code outside the module roots and
  `src/lib/` writes any table.

Adding a module:
- Create `backend/src/api/<m>/` (a domain service with no HTTP goes in `backend/src/services/<s>/`, without route,
  controller or validation):
  - `validation.ts` — Zod request schemas and their `z.output` types.
  - `service.ts` — `createXService(deps)` returning `XService`: the rules and the SQL. If another module will call
    it, export a narrow `XApi` (`Pick` / `Omit` of `XService`); take other modules' APIs as deps.
  - `controller.ts` — one handler per route, reading the service through `servicesOf(req)`.
  - `route.ts` — the route table; `export default router`.
  - `index.ts` — re-exports `xRouter`, `createXService` and the types, from its own folder only.
- Add the service to `Services` in `backend/src/context.ts`.
- In `backend/src/app.ts`, build it after the services it depends on, add it to `services` and its router to the
  mounted list.
- Add its entry to `OWNED` in `backend/tests/unit/architecture.test.ts` (an empty list when it writes no table).

## Data Flow

```
Browser ──► frontend/  Next.js 16 (App Router, client-side data fetching)
   │
   └── fetch, credentials: include ──► backend/  Express 5 API ──► Postgres 18
                                          │
                                          └──► Anthropic Messages API (server-side only)
```

SSE ask flow (`POST /api/thread/:id/message`; route in `api/thread/route.ts`, the `ask` handler in
`api/thread/controller.ts`, the turn in `api/thread/message.service.ts`):
1. After `requireSession`, the `requireAiEnabled` middleware checks the AI kill switch before validation, so the
   error order is kill switch → body (guide and quiz do the same; `MessageService.start` checks again as a backstop).
2. Validate the question (1–20,000 characters).
3. `MessageService.start` runs steps 3–7: recover stale turns of the user, then look up the thread (404 if it is not
   theirs).
4. Check the user's daily token budget, then the global daily cap.
5. Check the thread is not full (`thread_full`), then look up the topic.
6. Take the per-user generation lock (`AiApi.acquireLock`; ask holds it itself because it outlives the request,
   while guide and quiz use `AiApi.withGenerationLock`, which runs the budget checks and then the lock).
7. Save the user message.
8. The controller opens the stream (`openEventStream` in `lib/sse.ts`) and sends `message.start`;
   `MessageService.explain` streams the answer as `delta` events; the stream ends with `message.complete` or `error`.
   The history sent to the model is capped at 64,000 characters, newest turns kept.
9. `MessageService.finish` saves the assistant message and the `ai_call` row, and always releases the lock.
10. If the client disconnects, abort the upstream call and save the partial answer as `incomplete`.

- A heartbeat comment is sent every 15 s, and the response sets `X-Accel-Buffering: no` (both in `lib/sse.ts`).
- The upstream explain stream has a deadline: 45 s without a chunk (idle) or 180 s in total ends the call with an `error`
  event (the turn is saved as `failed`) (`backend/src/lib/tutor/anthropic.provider.ts`).
- The client reads the stream with `fetch` + `ReadableStream`, because `EventSource` can't send a POST.

## Auth
- Email + password, hashed with argon2id.
- Server-side sessions in table `session`, stored as the SHA-256 of a 256-bit random token.
- Cookie `sid`: HttpOnly, SameSite=Lax, Secure in production or whenever `FRONTEND_URL` is https, 30-day sliding expiry, rotated on login.
- CSRF: state-changing requests whose `Origin` isn't `FRONTEND_URL` are rejected with 403.
- `requireSession` middleware (`backend/src/middleware/auth.ts`) guards protected routes; it resolves the cookie
  through the `session` service of the app context.
- One ownership helper scopes every tenant query by `user_id`. Another user's resource returns 404, not 403.
- Login is limited to 5/min per IP + email (429), and to `LOGIN_IP_RATE_LIMIT` (default 30) per 15 min per IP across
  all emails. Sign-up is limited to `SIGNUP_RATE_LIMIT` (default 10) per hour per IP. IPv6 counts per /64.
- `TRUST_PROXY` is the number of reverse proxies in front of the backend (default 0: `X-Forwarded-For` is ignored).
  Behind a proxy set the hop count, or every client shares one IP and one limit.
- CORS: only `FRONTEND_URL` is allowed, with credentials. No wildcard origin is ever sent.

## External Dependencies
- Anthropic Messages API via `@anthropic-ai/sdk`: model `claude-haiku-4-5`, thinking off. `AI_PROVIDER=fake` is the
  default and is refused in production.
- Postgres 18.

## Operational Concerns
- pino structured logs with redaction: never message content, passwords, tokens, cookies or keys.
- `GET /health` is liveness; `GET /ready` checks the database.
- `ai_call` ledger: tokens, cache reads, stop reason, refusal category, latency.
- Budgets, checked before every generation:
  - Per-user daily budget (`AI_DAILY_TOKEN_BUDGET`, 429 `ai_budget_exceeded`), counted per day in the user's time
    zone. The time zone can change once per 24 h (409 `time_zone_recently_changed`, `app_user.time_zone_changed_at`),
    so it cannot be moved to reset the budget.
  - Global budget (`AI_GLOBAL_DAILY_TOKEN_BUDGET`): all users together since UTC midnight; reached: 503 `ai_unavailable`.
  - One generation in flight per user.
- `AI_ENABLED=false` is the kill switch (503 `ai_unavailable`), checked by the `requireAiEnabled` middleware before
  validation for ask, guide and quiz.
- Boot recovery: before listening, `recoverAtBoot()` (`backend/src/app.ts`, awaited in `backend/src/index.ts`) fails
  every unfinished turn created before boot and clears every generation lock. It assumes a single backend instance:
  with two, one booting would fail the other's live turns. `RECOVER_STALE_ON_BOOT=false` skips it (the e2e stack).
  Recovery past the 600 s lock TTL still runs lazily on ask and thread view, probing a partial index
  (migration 010) first so the common case stays cheap.
- Database pool timeouts (`backend/src/lib/db/index.ts`): connect 5 s, statement 15 s (the CLI opts out),
  idle-in-transaction 30 s. A failure to get a connection answers 503 `db_unavailable`.
- API headers: `helmet` defaults, with `Cross-Origin-Resource-Policy: same-site` (frontend :3000 and API :4000 are same-site).
- Frontend headers: a per-request-nonce CSP set in `frontend/src/proxy.ts` (`script-src` `self` + nonce + `strict-dynamic`,
  `connect-src` limited to self and the API origin, `frame-ancestors` none, no `wasm-unsafe-eval`: Shiki uses its JavaScript
  regex engine), plus `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a deny-all `Permissions-Policy`.
  Every page renders per request (the root layout awaits `connection()`) so the nonce can be applied.
- `bun run check:bundle` fails if `sk-ant` or `ANTHROPIC` appears in the client output (`frontend/.next/static`) of a production build (AC12); server-rendered output is out of its reach.
- Practice Docker images and a `full` compose profile exist (see the README); nothing deploys them.
- CI (`.github/workflows/ci.yml`) runs on push to `main` and on pull requests, with install and Playwright caches
  and e2e traces kept on failure. `check:bundle` needs a production build and scans its client output for canary key values injected
  at build time. A parallel `image` job builds the backend and both Docker images.
- Test databases are per checkout (a suffix from the hash of the checkout path), so two clones never reset each other's.
- Local only — there is no hosted environment (plan 001, Q11).

## Change Log
- 2026-10-08 — API layout: src/api/<m> route/controller/service/validation, src/services/ai, src/middleware, per-app context; boolean wire fields renamed (plan 004).
- 2026-10-07 — Review hardening (plan 003): boot recovery, stream deadline, DB timeouts, AI cost controls, per-IP limits, CI on main.
- 2026-10-07 — Backend restructured into feature modules with explicit dependency injection (plan 002).
- 2026-10-07 — P6 hardening: CORS rule, API and frontend security headers, CSP, bundle secret check.
- 2026-10-06 — Initial architecture for plan 001 (AI Tutor MVP).
