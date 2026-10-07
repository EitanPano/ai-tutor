# Glossary

## Purpose
- Define canonical domain terms and approved short forms used across code, API routes, docs, and plans.

## Core Terms

| Term | Meaning |
|---|---|
| `user` | An account. The table is `app_user` because `user` is a reserved word in Postgres. |
| `session` | An **auth** session only. It never means "study session". |
| `topic` | A subject from the fixed taxonomy (`react`, `sql`, `git`, …, `other`). |
| `thread` | A conversation made of questions and explanations. |
| `message` | One turn in a thread (`role`: `user` / `assistant`). |
| `guide` | Step-by-step guidance generated from a thread. |
| `step` | One ordered item in a guide (table `guide_step`). |
| `quiz` | A generated set of multiple-choice items. |
| `quiz_item` | One question in a quiz. It's not called "question", because that word means the user's coding question. |
| `attempt` | One graded submission of a quiz (table `quiz_attempt`). |
| `ai_call` | Ledger row for each model call: model, tokens, cache reads, stop reason, latency. |
| `budget` | A user's daily AI token allowance (`AI_DAILY_TOKEN_BUDGET`), counted per calendar day in the user's time zone. |
| `streak` | Consecutive days (user's time zone) with at least one question asked, step completed, or attempt submitted. |
| `generation` | One in-flight AI call (explain, guide or quiz); a user has at most one at a time. |

## Not used
- `org` — there is no tenancy beyond the user (plan 001, Q2).
- `question` for quiz items — use `quiz_item`.
- `study session` — `session` means auth only.

## Naming Alignment
- Keep this glossary aligned with naming decisions in `../.claude/rules/naming.md`.
- If a new domain term is introduced, add it here before broad usage.
- Avoid synonyms for existing terms unless explicitly approved and documented here.
