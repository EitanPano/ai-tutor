# AI4Dev Agent Files

A structured workspace for running an AI-driven product development loop.

This repository holds the source-of-truth instructions, product docs, planning artifacts, and orchestration outputs used to build the AI Tutor for Developers MVP (ask, explain, guide, quiz, progress) through specialized agents.

## What this repository is

- A coordination and governance repo for multi-agent delivery
- A place to keep product intent, architecture notes, backlog, and implementation plans aligned
- A contract handoff point for future backend implementation

## Current project focus

- Product: AI Tutor for Developers
- Scope: Full-stack MVP (Next.js + Express + Postgres), local only — see plan 001
- Delivery model: Orchestrator -> Frontend/Backend (when needed) -> QA

See the product definition in .doc/product-definition.md.

## Repository map

| Path | Purpose |
|---|---|
| AGENTS.md | Canonical operating rules and guardrails for all agents |
| CLAUDE.md | Loads AGENTS.md into compatible runtimes |
| frontend/ | Next.js app |
| backend/ | Express API |
| compose.yaml | Local Postgres, plus the `full` profile (migrate, backend, frontend images) |
| .doc/ | Product and architecture source docs |
| .plan/ | Prioritized backlog and approved implementation plans |
| .claude/rules/ | Always-on coding and workflow constraints |
| .claude/skills/ | On-demand procedural playbooks |
| .claude/agents/ | Role definitions for orchestrator, frontend, backend, qa, and security-reviewer |
| .claude/hooks/ | Runtime guardrails that enforce boundaries and safety |
| .orchestrate/ | Generated outputs from the latest dev-loop run |
| .github/copilot-instructions.md | Copilot entry point that points to AGENTS.md |

## How work moves through this repo

1. Add or prioritize tasks in .plan/000-backlog.md.
2. Create or update an implementation plan in .plan/NNN-YYYY-MM-DD-topic.md.
3. Execute the dev loop in your local environment.
4. Review generated artifacts in .orchestrate/:
   - PLAN.md mirror
   - api-contract.yaml
   - agent reports
   - qa-report.md
   - trace.json
5. Validate acceptance criteria against .doc/product-definition.md.

## Source of truth and generated files

- Durable, hand-maintained sources:
  - .doc/
  - .plan/
  - .claude/rules/
  - .claude/skills/
  - AGENTS.md
- Generated, disposable artifacts:
  - .orchestrate/* (except .orchestrate/README.md, which documents the folder)

## Run it locally

Prerequisites: Node 24, Bun 1.4, Docker Desktop.

```sh
bun install
docker compose up -d --wait db     # Postgres 18 on 127.0.0.1:5432
bun run db:migrate
bun run db:seed                    # demo user + sample data
bun run dev                        # frontend :3000, backend :4000
```

Open http://localhost:3000 and sign in with `demo@example.com` / `demo-password`. The fake AI provider is the
default: answers are canned, deterministic and cost nothing.

**Real answers.** Copy `backend/.env.example` to `backend/.env`, set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`
(use a key from its own Console workspace with a low spend limit, plan P0.11), then restart `bun run dev`.

### Quality gates

| Command | What it does |
|---|---|
| `bun run typecheck` | `tsc` in both workspaces |
| `bun run lint` | ESLint + Prettier check |
| `bun run test` | Backend (real `ai_tutor_test` DB) and frontend unit suites, run sequentially |
| `bun run test:e2e` | Playwright against an isolated stack on :3100 / :4100 and DB `ai_tutor_e2e` |
| `bun run gen:api` | Regenerates `frontend/src/types/api.ts` from `.orchestrate/api-contract.yaml` |
| `bun run check:bundle` | AC12: fails if `sk-ant` or `ANTHROPIC` appears in `frontend/.next` (run `bun run --filter frontend build` first) |

Use `bun run test`, never `bun test`.

### Full stack in Docker (practice only, nothing deploys it)

Builds production images for the backend and frontend and runs them next to the same Postgres. Stop `bun run dev`
first: the images use ports 3000 and 4000. Production mode refuses the fake provider, so a real provider is required.

```powershell
$env:AI_PROVIDER = 'anthropic'
$env:ANTHROPIC_API_KEY = '<a low-spend-limit key>'
docker compose --profile full up -d --build
# http://localhost:3000  (API on http://localhost:4000)
docker compose --profile full down      # keeps the pgdata volume
docker compose up -d --wait db          # `down` also removes the db container; bring it back for dev
```

If the full profile does not come up, run `docker compose logs backend` first (a missing key or bad config shows there;
the backend restarts at most 3 times on failure instead of looping). `docker compose up -d db` (no profile) starts only Postgres. Host ports are published on 127.0.0.1 only; inside the
containers the servers listen on 0.0.0.0 so those mappings can reach them. A missing key fails the backend at start
with `ANTHROPIC_API_KEY: required when AI_PROVIDER=anthropic`. `NEXT_PUBLIC_API_URL` is baked into the frontend
image at build time (compose arg), so changing the API address means rebuilding it. Docker overrides `HOSTNAME` with the
container id, so compose sets `HOSTNAME=0.0.0.0` at run time; a plain `docker run` of the frontend image needs
`-e HOSTNAME=0.0.0.0` or the server will not be reachable through the port mapping.

## Operations

- **Health:** `GET /health` is liveness (no dependencies). `GET /ready` checks the database and returns 503
  `db_unavailable` when it is down.
- **Logs:** pino JSON on stdout (pretty in development). Message content, passwords, hashes, session tokens, cookies
  and API keys are never logged. Each response carries `X-Request-Id`, and error bodies repeat it as `requestId`.
- **Kill switch:** `AI_ENABLED=false` makes the AI routes return 503 `ai_unavailable`; history and progress keep
  working. `AI_PROVIDER=fake` stops all spend at once (not allowed in production).
- **Daily budget:** `AI_DAILY_TOKEN_BUDGET` (default 50000) caps tokens per user per day; one generation runs per user
  at a time.
- **Time zones (migration 007):** it normalises stored `app_user.time_zone` values to Postgres spellings (for example
  `Asia/Calcutta` becomes `Asia/Kolkata`) and resets unknown or offset-style values (such as `+01:00`) to `UTC`. Its
  down migration is a no-op, so a rollback does not restore the old values.
- **Operator password reset:** `bun run --filter backend user:reset-password <email>` ends that user's sessions and
  prints a temporary password once.
- **Log everyone out:** delete the rows of `session` (`DELETE FROM session;`).
- **Rollback:** code, revert the merge commit. Database, `bun run db:rollback` undoes the last migration (each has a
  tested `down`). Drops never ship in the same release as the code that stops using the dropped column.
- **Dependency audit (`bun audit`, 2026-10-07):** two advisories, both dev/build-time only, no runtime exposure.

| Package | Severity | Path | Runtime? | Triage |
|---|---|---|---|---|
| `braces@3.0.3` | high (stack exhaustion on deeply nested patterns) | `eslint-config-next > @next/eslint-plugin-next > fast-glob > micromatch` | No: ESLint only, patterns are our own globs | No fixed version is published; `bun audit fix` cannot help. Accepted, re-check on the next `eslint-config-next` bump |
| `postcss-selector-parser@6.0.10` | moderate (quadratic CPU on flat selectors) | `@tailwindcss/typography` | No: Tailwind build time, input is our own CSS | Fix is 7.1.6 but `@tailwindcss/typography@0.5.20` pins `^6`; a major override is riskier than the exposure. Accepted, re-check on the next typography release |

## Troubleshooting

- **Known issue:** On Windows with Node 24.15, running the backend and frontend Vitest suites concurrently under heavy CPU load can natively abort a test worker (exit code 3221226505). The root `bun run test` runs them sequentially to avoid it. Root cause unconfirmed (see the commit message for the investigation summary).
