# System Architecture

## Purpose
- Provide a concise architecture reference for service boundaries, ownership, and major flows.

## Primary Components
- Browser — talks only to `frontend/` and `backend/`, never to Anthropic.
- `frontend/` — Next.js 16 (App Router) on :3000. Client components with TanStack Query and a typed client in
  `frontend/src/lib/api/`. `frontend/src/proxy.ts` redirects to `/login` when the `sid` cookie is missing; this is
  UX only, the backend is the authority on auth.
- `backend/` — Express 5 API on :4000, split into feature modules (see Backend Modules):
  - `src/feature/<m>/` — one module per domain: route (HTTP and Zod validation), service (domain rules and
    ownership; `auth: { userId }` is passed explicitly), and an `index.ts` that exposes only `createXModule` and types.
  - `src/http/` — Express helpers with no domain logic.
  - `src/lib/` — infrastructure: db (Kysely), tutor provider, rate limit, config, logger.
  - `src/app.ts` — composition root: builds the modules in dependency order and mounts their routers.
- Postgres 18 — run locally through `compose.yaml`.
- Anthropic Messages API — called from the backend only (server-side).

## Backend Modules

| Module | Owns (tables it writes) | Public API | Depends on |
|---|---|---|---|
| `user` | `app_user`, `session` | router only (also builds the shared `requireSession` middleware) | — |
| `topic` | `topic` | `TopicApi`: `require` | — |
| `ai` | `ai_call`, `app_user` (`generation_started_at` only) | `AiApi`: `assertEnabled`, `assertWithinBudget`, `recordCall`, `acquireLock`, `releaseLock`, `withGenerationLock`, `generateValidated`, `lockTtlSeconds` (no router) | — |
| `thread` | `thread`, `message` | `ThreadApi`: `require`, `assertHasAnswer`, `history` | `TopicApi`, `AiApi` |
| `guide` | `guide`, `guide_step` | router only | `TopicApi`, `AiApi`, `ThreadApi` |
| `quiz` | `quiz`, `quiz_item`, `quiz_attempt` | router only | `TopicApi`, `AiApi`, `ThreadApi` |
| `progress` | none (read-only) | router only | — |
| `health` | none | router only | — |

`thread`, `guide`, `quiz` and `progress` also receive `requireSession` from `user`; `topic` and `health` do not.

Boot recovery is not part of `ThreadApi` (it is a system-wide sweep, so guide and quiz must not hold it).
`createThreadModule(...)` returns the turn sweep separately as `recoverStale`; `createApp` combines it with the `ai`
module's `releaseAllLocks` into `recoverAtBoot()` and exposes that to `src/index.ts` and tests through `AppModules`
(see Boot recovery).

Dependency order: `user`, `topic`, `ai` → `thread` → `guide`, `quiz`; `progress` and `health` are standalone.

Rules:
- Modules call each other only through an injected `XApi`. Across modules only `import type` from
  `../<other>/index.js` is allowed; values are injected in `src/app.ts`.
- `auth` is an explicit first argument of every `XApi` method that acts for a user.
- A table is written only by its owner. Cross-module reads through SQL joins are allowed (thread detail, the guide
  ownership join, progress).
- `ai.releaseLock(…, tx)` is the one cross-module write inside another module's transaction.

Enforcement:
- dependency-cruiser (`backend/.dependency-cruiser.cjs`, run by `bun run lint`):
  - `no-circular` — no import cycles.
  - `infra-is-leaf` — `src/lib/` and `src/http/` never import features or `app.ts`.
  - `not-to-unresolvable` — every import must resolve.
  - `cross-module-type-only` — a module imports another module only with type-only imports.
  - `module-public-api-only` — a module reaches another only through its `index.ts`.
  - `feature-values-own-or-infra` — a module imports values only from itself, `src/lib/` and `src/http/`, so a
    re-export from a new folder or top-level file cannot launder another module's values.
  - `outside-uses-public-api` — code outside `src/feature/` (`app.ts`, `index.ts`, any other folder) reaches a module
    only through its `index.ts`.
  - `index-exports-module-only` — an `index.ts` re-exports values only from its own `<m>.module.ts`.
- ESLint `@typescript-eslint/no-import-type-side-effects` — type imports are written `import type { X }`, never
  `import { type X }`: with `verbatimModuleSyntax` the inline form leaves a runtime import behind, which dependency-cruiser
  would report as type-only.
- `OWNED` in `backend/tests/unit/architecture.test.ts` is the source of truth for write ownership; the test fails
  when a module writes a table it does not own, when a table in `db/schema.sql` has no single owner (the `SHARED`
  allowlist covers `app_user`; `rate_limit` is written by `src/lib/`), and when `src/feature/` holds a loose file.

Adding a module:
- Create `backend/src/feature/<m>/` with `<m>.module.ts`, `<m>.service.ts`, `<m>.route.ts`, `<m>.schema.ts`, `index.ts`.
- Declare `XApi` in `<m>.module.ts`, with the other modules' APIs as injected deps.
- Export only `createXModule` and types from `index.ts`.
- Wire it in `backend/src/app.ts`, after the modules it depends on.
- Add its entry to `OWNED` in `backend/tests/unit/architecture.test.ts`.

## Data Flow

```
Browser ──► frontend/  Next.js 16 (App Router, client-side data fetching)
   │
   └── fetch, credentials: include ──► backend/  Express 5 API ──► Postgres 18
                                          │
                                          └──► Anthropic Messages API (server-side only)
```

SSE ask flow (`POST /api/thread/:id/message`):
1. Check the AI kill switch, first at the route, before the body is looked at (guide and quiz do the same).
2. Validate the question (1–20,000 characters).
3. Recover stale turns of the user, then look up the thread (404 if it is not theirs).
4. Check the user's daily token budget, then the global daily cap.
5. Check the thread is not full (`thread_full`), then look up the topic.
6. Take the per-user generation lock (`AiApi.acquireLock`; ask holds it itself because it outlives the request,
   while guide and quiz use `AiApi.withGenerationLock`, which runs the budget checks and then the lock).
7. Save the user message.
8. Stream the answer: `message.start`, then `delta` events, then either `message.complete` or `error`. The history
   sent to the model is capped at 64,000 characters, newest turns kept.
9. Save the assistant message and the `ai_call` row.
10. If the client disconnects, abort the upstream call and save the partial answer as `incomplete`.

- A heartbeat is sent every 15 s, and the response sets `X-Accel-Buffering: no`.
- The upstream explain stream has a deadline: 45 s without a chunk (idle) or 180 s in total ends the call with an `error`
  event (the turn is saved as `failed`) (`backend/src/lib/tutor/anthropic.provider.ts`).
- The client reads the stream with `fetch` + `ReadableStream`, because `EventSource` can't send a POST.

## Auth
- Email + password, hashed with argon2id.
- Server-side sessions in table `session`, stored as the SHA-256 of a 256-bit random token.
- Cookie `sid`: HttpOnly, SameSite=Lax, Secure in production or whenever `FRONTEND_URL` is https, 30-day sliding expiry, rotated on login.
- CSRF: state-changing requests whose `Origin` isn't `FRONTEND_URL` are rejected with 403.
- `requireSession` middleware guards protected routes.
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
- `AI_ENABLED=false` is the kill switch (503 `ai_unavailable`), checked first at the route for ask, guide and quiz.
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
- 2026-10-07 — Review hardening (plan 003): boot recovery, stream deadline, DB timeouts, AI cost controls, per-IP limits, CI on main.
- 2026-10-07 — Backend restructured into feature modules with explicit dependency injection (plan 002).
- 2026-10-07 — P6 hardening: CORS rule, API and frontend security headers, CSP, bundle secret check.
- 2026-10-06 — Initial architecture for plan 001 (AI Tutor MVP).
