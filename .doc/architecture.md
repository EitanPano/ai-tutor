# System Architecture

## Purpose
- Provide a concise architecture reference for service boundaries, ownership, and major flows.

## Primary Components
- Browser — talks only to `frontend/` and `backend/`, never to Anthropic.
- `frontend/` — Next.js 16 (App Router) on :3000. Client components with TanStack Query and a typed client in
  `frontend/src/lib/api/`. `frontend/src/proxy.ts` redirects to `/login` when the `sid` cookie is missing; this is
  UX only, the backend is the authority on auth.
- `backend/` — Express 5 API on :4000, in three layers:
  - `src/route` — HTTP and Zod validation.
  - `src/service` — domain rules and ownership; `auth: { userId }` is passed explicitly.
  - `src/lib` — db (Kysely), tutor provider, rate limit, config, logger.
- Postgres 18 — run locally through `compose.yaml`.
- Anthropic Messages API — called from the backend only (server-side).

## Data Flow

```
Browser ──► frontend/  Next.js 16 (App Router, client-side data fetching)
   │
   └── fetch, credentials: include ──► backend/  Express 5 API ──► Postgres 18
                                          │
                                          └──► Anthropic Messages API (server-side only)
```

SSE ask flow (`POST /api/thread/:id/message`):
1. Validate the question (1–20,000 characters).
2. Check the user's daily token budget.
3. Take the per-user generation lock.
4. Save the user message.
5. Stream the answer: `message.start`, then `delta` events, then either `message.complete` or `error`.
6. Save the assistant message and the `ai_call` row.
7. If the client disconnects, abort the upstream call and save the partial answer as `incomplete`.

- A heartbeat is sent every 15 s, and the response sets `X-Accel-Buffering: no`.
- The client reads the stream with `fetch` + `ReadableStream`, because `EventSource` can't send a POST.

## Auth
- Email + password, hashed with argon2id.
- Server-side sessions in table `session`, stored as the SHA-256 of a 256-bit random token.
- Cookie `sid`: HttpOnly, SameSite=Lax, Secure in production, 30-day sliding expiry, rotated on login.
- CSRF: state-changing requests whose `Origin` isn't `FRONTEND_URL` are rejected with 403.
- `requireSession` middleware guards protected routes.
- One ownership helper scopes every tenant query by `user_id`. Another user's resource returns 404, not 403.
- Login is limited to 5/min per IP + email (429).

## External Dependencies
- Anthropic Messages API via `@anthropic-ai/sdk`: model `claude-haiku-4-5`, thinking off. `AI_PROVIDER=fake` is the
  default and is refused in production.
- Postgres 18.

## Operational Concerns
- pino structured logs with redaction: never message content, passwords, tokens, cookies or keys.
- `GET /health` is liveness; `GET /ready` checks the database.
- `ai_call` ledger: tokens, cache reads, stop reason, refusal category, latency.
- Daily token budget per user, and one generation in flight per user.
- `AI_ENABLED=false` is the kill switch (503 `ai_unavailable`).
- Local only — there is no hosted environment (plan 001, Q11).

## Change Log
- 2026-10-06 — Initial architecture for plan 001 (AI Tutor MVP).
