# Product Definition

## Purpose
- A study project: built to learn and practice, not to serve real users.
- Cost wins over quality. API, CI and hosting costs stay at a minimum, and the quality of AI answers doesn't
  matter (plan `001`, assumption A9).
- It runs locally only. There is no hosted environment.

## Product Vision
- A developer opens a thread, asks a coding question, and learns from the answer instead of just copying it.
- One place to go from a question to an explanation, to a step-by-step guide, to a quiz, and to a record of progress.

## Problem Statement
- Developers get answers to coding questions but rarely turn them into understanding they can retain.
- Answers, practice and progress live in separate tools, so there is no record of what a developer has learned.

## Value Proposition
- Streamed AI explanations, with follow-ups that keep the thread's context.
- Guides that break a thread into steps the developer works through and checks off.
- Multiple-choice quizzes graded deterministically on the server.
- Per-topic progress and a daily streak that show learning over time.

## Product Scope
- In scope:
  - Ask a coding question (prose and code blocks) inside a thread.
  - An AI explanation streamed back, with follow-ups that keep the thread's context.
  - Step-by-step guidance: turn a thread into a guide whose steps the user works through and checks off.
  - A multiple-choice quiz generated from a thread or a topic, taken and graded.
  - Per-topic progress over time.
- Out of scope:
  - Running user code (needs a sandbox and is its own security project).
  - Free-text quiz answers graded by AI. The MVP is multiple choice only.
  - Password reset and email verification (both need an email provider).
  - Teams and classrooms. There is no `org`; all data is owned by a user.
  - Payments, admin console, i18n, mobile app, and a self-serve account export/delete UI.
  - Spaced repetition and adaptive difficulty.

## Target Users
- Primary users: individual developers on a desktop browser (A2). The UI is English only (A5).
- Secondary users: the owner, using the product as a study project (see Purpose).

## Acceptance Criteria
Each criterion must be provable by a test.
- AC01 — Quality gates: `bun run typecheck`, `bun run lint`, `bun run test` (both workspaces) and `bun run test:e2e` all exit 0. Running `bun run gen:api` leaves `frontend/src/types/api.ts` unchanged. (proven by: root scripts; `git diff --exit-code` after `gen:api` (CI))
- AC02 — Sign up, log out and log in work. Protected endpoints return 401 with the standard error shape when there's no session. (proven by: `backend` integration `session.test.ts`; e2e `auth.spec.ts`)
- AC03 — User B gets 404 when reading or writing user A's thread, guide, quiz or attempt. (proven by: `backend` integration `ownership.test.ts`)
- AC04 — Asking a question streams the explanation (at least 2 `delta` events before `message.complete`). It's saved and still visible after a reload. (proven by: integration test with the fake provider; e2e `ask.spec.ts`)
- AC05 — A follow-up sends the earlier thread turns to the provider. (proven by: unit test: the fake provider records its input)
- AC06 — A generated guide has 3–8 steps. Revealing a hint and marking a step done or undone persist across a reload. (proven by: integration + e2e `guide.spec.ts`)
- AC07 — A quiz has 5 multiple-choice items. The `GET /api/quiz/:id` body has no `answer_index` or `explanation`. An attempt returns the score and per-item correctness. An incomplete attempt returns 422. (proven by: integration `quiz.test.ts`; e2e `quiz.spec.ts`)
- AC08 — `/progress` shows per-topic counts and a streak that match the seeded fixture. (proven by: integration `progress.test.ts` with a frozen clock; e2e)
- AC09 — Going over the daily budget returns 429 `ai_budget_exceeded`. A second ask while one is in flight returns 409 `generation_in_progress`. A 13th question in a thread returns 409 `thread_full`. The UI shows a toast for each. Changing the time zone twice within 24 hours returns 409 `time_zone_recently_changed` (the budget day follows the time zone). Once all users together reach the global daily cap, an ask returns 503 `ai_unavailable`. (proven by: integration + unit; time zone limit: integration `user.test.ts`; global cap: integration `ask.test.ts` and `guide.test.ts`)
- AC10 — When the provider errors, refuses, or returns invalid structured output, the user sees a safe error message and the assistant message is saved as `failed` or `incomplete`, never `complete`. Retry works. (proven by: integration using the fake provider's failure modes)
- AC11 — An empty question, or one over 20,000 characters, returns 400 with `error.details`. The sixth login attempt within a minute returns 429. (proven by: integration)
- AC12 — The client output of a production build (`frontend/.next/static`) contains no `sk-ant` or `ANTHROPIC` string (server-rendered output is out of this check's reach). The `sid` cookie is `HttpOnly; SameSite=Lax`, plus `Secure` in prod. An explanation containing `<img src=x onerror=alert(1)>` renders as text. A state-changing request with a foreign `Origin` returns 403. (proven by: build grep script; integration; unit (markdown renderer))
