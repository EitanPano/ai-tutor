# 003 — Review hardening

Status: done
Owner: Eitan
Last updated: 2026-10-07
Approval: scope and Q2–Q3 answered in chat on 2026-10-07; plan approved as written (Q4 included) the same
day.
Backlog task: `review hardening | stack:full | plan:003` in `.plan/000-backlog.md`
Builds on: `001-2026-10-06-ai-tutor-mvp.md` (product rules, A9 cost first) and
`002-2026-10-07-backend-module.md` (module structure, boundary rules; both stay as they are)

## Goal

Fix what a whole-codebase review (security, backend, frontend, tests/CI/ops; 2026-10-07) found, ranked for
what this app is: a local study project that spends the owner's Anthropic key.

1. **Bugs that hit today** — a lock that survives a restart, lost questions, lost drafts, duplicate AI
   generations, mangled pasted code, requests that hang instead of failing.
2. **AI cost controls** — no request or account can spend far past the daily budget.
3. **Performance and maintainability** — cheaper streaming, cheaper hot-path queries, one copy of the
   lock/budget sequence, proper error/404/loading pages.
4. **CI and tests** — CI runs on `main`, keeps evidence on failure, builds what ships, and its secret check
   can actually catch a leak.

## Scope

### In scope

The steps below. Finding IDs refer to the review reports (`B` backend, `S` security, `F` frontend, `Q`
tests/CI/ops); the reports themselves are scratch files and are not committed.

### Out of scope

- Multi-instance readiness (sub-project B). The boot recovery in step 1 assumes one instance, as today.
- Guide and quiz cancellation and shutdown tracking (B-F3); caps on failed turns and quiz attempts (B-F12).
- Separate Postgres roles for migrations and runtime (S-L1); session revocation and password change (S-L4);
  showing link hostnames in answers (S-L2); per-user quotas on cheap writes (S-L3).
- Splitting CI into parallel jobs (Q04, beyond caching); coverage reporting (Q13); DST and east-of-UTC
  streak tests (Q07); frontend `noUncheckedIndexedAccess` (Q11); pinning image tags and a scheduled audit
  (Q10, Q12).
- Caching `pg_timezone_names` in memory (S-M3, part 3): the per-IP limiters in step 11 already bound the
  unauthenticated work.

## Assumptions

- A1. The branch `fix/review-hardening` starts from `chore/backend-module` (PR #5) after PR #4's latest
  fixes are merged into it (`9db4dfb`, `0e1cb18`, `f91621a`); steps 4 and 17 edit `use-ask.ts`, which
  `f91621a` changed.
- A2. One backend instance (plan 001, Q11). A turn or lock that exists at boot belongs to a dead process.
- A3. The existing suites are the safety net (backend 362, frontend 209 unit, 37 e2e at the start). A step
  that changes behaviour adds or updates a test first.
- A4. API contract changes go through `.orchestrate/api-contract.yaml` and `bun run gen:api` in the same
  commit. Schema changes go into `backend/db/schema.sql` and a new `backend/db/migration/NNN-*.sql`
  together (skill `database-schema`).
- A5. New environment variables get a default that keeps local development working without setting them,
  are validated in `backend/src/lib/config.ts`, and are listed in `backend/.env.example` and the README.

## Open Questions

Answered in chat on 2026-10-07.

**Q1 — Which tiers?** **Answered: all four.**

**Q2 — How does a time-zone change stop resetting the AI budget?** **Answered: at most one time-zone
change per 24 hours.** Keeps "resets at midnight in your time zone". Rejected: a rolling 24-hour window
(changes the product message and when spend frees up); leaving it (relies only on the console spend limit).

**Q3 — Delivery?** **Answered:** new branch and this plan, one commit per step, pushed with a pull request
stacked on PR #5.

**Q4 — How is one request kept from spending several days' budget?** **Recommended: cap the history sent
to the model** (step 9) and keep the `used >= budget` pre-check. A request then costs at most about one
day's budget in the worst case. Rejected: a pre-call estimate that rejects when `used + estimate > budget`,
because with 20,000-character questions a full thread would be rejected even at zero spend, and the
"budget spent" banner would be wrong for a request that is merely too large.

## Steps

Every step: write or update the failing test first, then the change; `bun run typecheck`, `bun run lint`
and `bun run test` green in each touched workspace; one Conventional Commit. `bun run test:e2e` runs at the
end of each phase.

### Phase A — Backend bugs

1. **Boot recovery clears everything left by the previous run** (B-F1). In `index.ts`, await recovery
   *before* `listen`: fail every unfinished turn created before boot (cutoff `now()`, not the lock TTL) and
   clear every `app_user.generation_started_at`. The lock clear lives in the `ai` module (its owner),
   returned beside its API as `releaseAllLocks()`; `createApp` exposes one `recoverAtBoot()`.
   `recoverStaleTurn` takes an explicit cutoff instead of `ttlSeconds`. Fix the stale "5 minutes" comment in
   `schema.sql` and `003-thread.sql`. Test: a 5-second-old orphan and a held lock are recovered at boot.
   `fix(backend): recover every turn and lock left by the previous run at boot`
2. **The explain stream has a deadline** (B-F2). In `anthropic.provider.ts`, an idle timeout (45 s without a
   stream event) and a total deadline (180 s), combined with the caller's signal via `AbortSignal.any`; a
   timeout throws `TutorProviderError` with the partial usage (a failed turn), a caller abort stays
   `aborted`. Guard the assistant update in `finishAsk` with `stop_reason IS NULL` so a late finish cannot
   overwrite a recovered turn. Update `generation-lock-ttl.test.ts`: TTL > 3 × 60 s + 180 s.
   `fix(backend): time out a stalled answer stream`
3. **Database calls fail fast** (B-F8, Q09). Pool options `connectionTimeoutMillis: 5000`,
   `statement_timeout: 15000`, `idle_in_transaction_session_timeout: 30000`; a pool connect timeout maps to
   503 `db_unavailable` in `errorMiddleware`. `fix(backend): give database connections and queries timeouts`

### Phase B — Frontend bugs

4. **A double click on Ask cannot cancel the answer** (F-F1). `stop()` ignores calls within 400 ms of
   `ask()`; a question that never started (`started === false`) returns to the composer on `stopped` too.
   Test: `userEvent.dblClick` on Ask. `fix(frontend): keep a double click on Ask from stopping the answer`
5. **A failed background session check keeps the page** (F-F2). `app-shell.tsx` blocks only when
   `session.isError && !session.data`. `fix(frontend): keep the page when a session refetch fails`
6. **No duplicate guide, quiz or attempt** (F-F3). Buttons stay busy while `isPending || isSuccess` until
   the route changes (`study-tools.tsx`, `use-create-quiz.ts`, `quiz-view.tsx`, `topic-table.tsx`), as
   `new-question.tsx` already does. `fix(frontend): prevent a second generation while the page changes`
7. **Pasted code in a question keeps its lines** (F-F5). A question renders as plain text with
   `whitespace-pre-wrap`, and as Markdown only when it contains a fenced block. Raw HTML stays text.
   `fix(frontend): show questions as written unless they use code fences`

### Phase C — AI cost controls

8. **One time-zone change per 24 hours** (S-H1, Q2). Column `app_user.time_zone_changed_at timestamptz`
   (migration `008`); `PATCH /api/user` with a *different* zone within 24 h of the last change returns
   409 `time_zone_recently_changed`; sign-up does not set it. Contract, `gen:api`, the frontend message in
   `MESSAGE_BY_CODE`, and the profile form shows it. `feat: allow one time zone change a day`
9. **History sent to the model is capped** (S-M1, B-F5, Q4). `buildHistory` keeps the newest turns within
   64,000 characters (about 16k tokens), dropping the oldest question-and-answer pairs first, never starting
   on an assistant turn. When a call ends before the provider reports usage, record an estimate
   (characters / 4) instead of zero. `fix(backend): cap the history sent to the model`
10. **A global daily cap** (S-H2, B-F4). `AI_GLOBAL_DAILY_TOKEN_BUDGET` (default 500,000 with `anthropic`,
    effectively unlimited with `fake`), summed over all users since UTC midnight; when spent, 503
    `ai_unavailable`. Index `ai_call (created_at)` (migration `009`).
    `feat(backend): add a global daily AI token cap`
11. **Per-IP limits on sign-up and login** (S-H2, S-M2, S-M3, B-F9). Sign-up: `SIGNUP_RATE_LIMIT` per hour
    per IP (default 10), checked before any hashing or database work. Login: `LOGIN_IP_RATE_LIMIT` per
    15 minutes per IP (default 30) beside the existing ip + email limiter. IPv6 addresses count per /64.
    Test and e2e environments raise both. `feat(backend): rate-limit sign-up and login per IP`
12. **The session cookie is `Secure` whenever the site is HTTPS** (S-L5). `secure` when `FRONTEND_URL` is
    `https:` or `NODE_ENV` is `production`. `fix(backend): mark the session cookie secure for https origins`

### Phase D — Performance and maintainability

13. **One lock and budget sequence** (B-F10, B-F11). `AiApi.withGenerationLock(auth, fn)` runs the kill
    switch, budget, acquire, `fn`, release in `finally`; guide and quiz use it, so errors come in one order.
    `AiApi.recordCall` takes a domain shape (`kind`, `model`, `usage`, `stopReason`, `refusalCategory`,
    `latencyMs`) and the `ai` module maps it to columns once. Duplicate `assertEnabled` calls go.
    `refactor(backend): share the generation lock sequence and the ledger mapping`
14. **The in-flight check is an index probe** (B-F6). Partial index on `message (user_id, created_at)` for
    unfinished assistant turns (migration `010`); a plain `SELECT` first, the transaction only when it finds
    rows. `perf(backend): find unfinished turns with a partial index`
15. **No cache-write surcharge on guide and quiz calls** (B-F7). Drop top-level `cache_control` from
    `structured()`; keep it on explain. `perf(backend): stop caching one-off guide and quiz prompts`
16. **Streamed text renders once per frame** (F-F4). `useAsk` buffers deltas and flushes on
    `requestAnimationFrame`; complete, error, stop and unmount flush or cancel.
    `perf(frontend): render streamed text at most once per frame`
17. **Narrower cache refreshes** (F-F6). After an ask, refresh the thread detail; refresh the list once,
    and on start only for a thread's first question. Seeded guide, quiz and attempt caches are not refetched
    at once (`staleTime`). The bounded wait in `useAsk` keeps `f91621a`'s rule (a missing turn is not saved
    yet). `perf(frontend): refresh only the thread queries an answer changed`
18. **One retry policy** (F-F10). `isRetryable(err, kind)` in `lib/api/error.ts` replaces the three
    `RETRYABLE` sets; `generation_in_progress` and `network_error` offer Retry for guide and quiz too.
    `refactor(frontend): share one retry policy`
19. **Error, not-found and loading pages** (F-F7, F-F8). `app/(app)/error.tsx` (Next 16.4 prop `retry`),
    `app/global-error.tsx`, `app/not-found.tsx`, and `loading.tsx` for thread, guide, quiz and progress
    reusing the existing skeletons (read the bundled Next 16 docs first).
    `feat(frontend): add error, not-found and loading pages`
20. **Each page has its own title** (F-F9). Thread, guide and quiz set `document.title` from their data.
    `fix(frontend): title pages after their thread, guide or quiz`

### Phase E — CI and tests

21. **CI runs on `main` and keeps evidence** (Q01, Q03, Q04). Trigger on `push` to `main`; cache the Bun
    install cache (key `bun.lock`) and Playwright browsers (key Playwright version); Playwright
    `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`; upload `frontend/test-results` with the
    report on failure. `ci: run on main, cache installs and keep e2e traces`
22. **The bundle secret check can fail** (Q06, F-F11). The CI build sets canary values for the Anthropic key
    names; the script requires a production build (`BUILD_ID`), honours `NEXT_DIST_DIR`, scans the client
    output (`static/`) for the canary and the markers, and fails without a build. ESLint bans importing
    `@anthropic-ai/sdk` in `frontend/`. `ci: make the bundle secret check detect a leaked key`
23. **CI builds what ships** (Q02). `bun run --filter backend build`, and `docker build` of both images.
    `ci: build the backend and both images`
24. **Test databases are per checkout** (Q05). Test and e2e database names take a suffix derived from the
    checkout path, so two worktrees never share one; `migration.test.ts` restores the schema in `afterAll`.
    `test: give each checkout its own test databases`

### Phase F — Docs

25. `.doc/architecture.md` (change log, boot recovery, budgets and limits), `.doc/glossary.md` (global
    budget), `.doc/product-definition.md` AC09 (time-zone limit, global cap), README and
    `backend/.env.example` (new variables), backlog line. `docs: describe the review hardening`

## Validation

- V1. From the repo root, `bun run typecheck`, `bun run lint` and `bun run test` exit 0.
- V2. `bun run test:e2e` passes (37 or more tests) locally and in CI.
- V3. `bun run gen:api` leaves `frontend/src/types/api.ts` unchanged after step 8.
- V4. Backend tests prove: boot recovery frees a 5-second-old turn and its lock (1); a stalled stream ends
  as a failed turn and a late finish does not overwrite a recovered one (2); a second time-zone change
  within 24 h returns 409 (8); a long thread sends at most 64,000 characters of history (9); the global cap
  returns 503 `ai_unavailable` (10); the eleventh sign-up from one IP within an hour returns 429 (11); the
  cookie is `Secure` for an `https:` `FRONTEND_URL` (12).
- V5. Frontend tests prove: a double click on Ask leaves the answer running (4); a failed session refetch
  keeps the page (5); a second click on Guide or Quiz after success does not call the API again (6); a
  pasted three-line snippet renders on three lines (7); deltas within one frame cause one render (16).
- V6. `migration.test.ts` passes, including `schema.sql` vs migrations parity for `008`–`010`.
- V7. In CI, `check:bundle` fails when run without a build (checked once, not committed) and passes on the
  real build (22).
- V8. A CI run on the pull request is green, including the backend build and both image builds (23).

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Boot recovery fails a live turn | High if two instances ever run | One instance by design (A2); the multi-instance plan replaces it with per-instance ownership |
| Rate limits break test suites that sign up many users from one IP | Medium | Limits are configurable; test and e2e environments raise them (step 11) |
| History cap changes what follow-ups and guides see | Low: only threads over about 16k tokens | Newest turns always kept; AC05 still holds; documented in step 25 |
| Stream deadline cuts a legitimately long answer | Low: 2,048 output tokens finish well within 180 s | Idle timeout, not only total; both constants in one place |
| Image builds lengthen CI | Low (A9: CI cost) | Built once per run with layer cache; dropped if CI time doubles |
| Conflicts with PR #4 / #5 | Medium | Start from PR #5 with PR #4's fixes merged in (A1); merge order #4 → #5 → this |

## Rollout Order

1. Phase A, then B, C, D, E, F; each step is green and committed on its own.
2. Migrations `008`, `009`, `010` land in steps 8, 10, 14, in that order.
3. Push and open a pull request stacked on PR #5 after phase F and a final whole-branch review.
4. Merge order: PR #4, PR #5, then this, each with Eitan's approval.

## Rollback

- Each step is one commit and can be reverted on its own. Steps 8, 10 and 14 add a column or index:
  reverting them leaves the column or index unused, or a down migration drops it.
- New limits and caps are environment variables: raising them turns the behaviour off without a deploy.
