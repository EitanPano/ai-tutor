# Agent Instructions

## communication with me
- Please start all your responses with a random word in  Yiddish with English tranlation!

## Security
- Never commit or expose secrets (tokens, API keys, passwords, cluster credentials, secret values).

## Guardrails (Single Source of Truth)
- Guardrail logic lives in `.claude/hooks/`. It is wired into the runtime by
  `.claude/settings.json`, which is the only location Claude Code reads hook and
  permission config from — a hook script that is not listed there never runs.
- Do not duplicate permission or hook rules in other agent docs.
- If any instruction conflicts with the hooks, the hooks win.
- `dev-loop.js` sets `AGENT_ROLE` when it spawns a sub-agent; that is what
  `.claude/hooks/enforce-agent-boundaries.js` uses to enforce per-role write paths.

## Tooling
- Bun is the package manager and script runner: `bun install`, `bun add`, `bun run <script>`,
  `bunx <bin>`. Never use npm, npx, yarn or pnpm. `bun.lock` is the only lockfile.
- Run package scripts with `bun run test`, never `bun test`: `bun test` starts Bun's own
  test runner and skips the project's Vitest setup.
- Next.js 16 docs are bundled at `frontend/node_modules/next/dist/docs/`; read them before using a Next API.

## Repository Layout
- `.doc/` — hand-written product and architecture docs.
- `.claude/rules/` — always-on constraints, imported below. Short by design.
- `.claude/skills/` — procedural know-how, loaded on demand by task.
- `.claude/agents/` — sub-agent definitions used by the dev loop.
- `.claude/hooks/` — guardrail hook implementations, wired by `.claude/settings.json`.
- `.plan/` — `000-backlog.md` is the task queue; `NNN-YYYY-MM-DD-*.md` are the plans.
- `.orchestrate/` — everything the dev loop generates (plan mirror, tickets, agent
  reports, QA report, API contract, cost traces). Never create a `docs/` directory.
  `.orchestrate/api-contract.yaml` is the one versioned file there: the frontend/backend
  handshake (OpenAPI 3.1).
- `frontend/` — the Next.js app.
- `backend/` — the Express 5 API, split into modules.
  - `src/api/<m>/` — one HTTP module per domain: `route`, `controller`, `service`, `validation`, `index`.
  - `src/services/<s>/` — domain services with no HTTP (`ai`).
  - `src/middleware/` — Express middleware (session, validation, rate limits, AI kill switch, errors).
  - `src/lib/` — infrastructure; it imports nothing else under `src/`.
  - `src/context.ts` — the per-app context; handlers read it per request through `ctxOf(req)` / `servicesOf(req)`.
  - `src/app.ts` — wiring: builds the services in dependency order and mounts the routers.
  - Modules call each other only through `import type` of a narrow `XApi`, with values injected in `src/app.ts`.
    Boundaries are enforced by dependency-cruiser in `bun run lint` and by
    `backend/tests/unit/architecture.test.ts` (table write ownership).
  Schema lives in `db/schema.sql` (full bootstrap) and `db/migration/` (`NNN-*.sql`);
  change both together.
- `compose.yaml` — local Postgres 18 (`docker compose up -d --wait db`).

## Rules — always in context
@.claude/rules/code-style.md
@.claude/rules/naming.md
@.claude/rules/ui-and-styling.md
@.claude/rules/git-workflow.md

## Skills — load when the task calls for it
| Skill | Use it when |
|---|---|
| `writing-plans` | Creating, revising, or superseding a plan in `.plan/` |
| `writing-tests` | Adding or reviewing unit, integration, or e2e tests |
| `error-handling` | Shaping an error response, status code, retry, or failure UX |
| `database-schema` | Adding or changing a table, column, index, or migration |
| `cutting-a-release` | Choosing a version number or tagging a release |

## Product and Domain
- Product definition and acceptance criteria: `.doc/product-definition.md`.
- Architecture overview: `.doc/architecture.md`.
- Canonical domain terms: `.doc/glossary.md` — document a new shared term there
  before using it broadly.
- Keep these docs updated when API routes, auth/org boundaries, or schema/migrations change.
