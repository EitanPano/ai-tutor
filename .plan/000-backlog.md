# Prioritized Backlog

The task queue. Work starts from the first unchecked item under `Current queue`, top to bottom.

Format:
- `- [ ] <title>`
- `- [ ] <title> | figma:<url>`   optional design reference
- `- [ ] <title> | stack:full`    opts the task into the backend stage
- `- [ ] <title> | plan:<NNN>`    the task runs from an existing plan; don't write a new one

Rules:
- Order is priority. Move a line to reprioritize it.
- Only `- [ ]` lines under `Current queue` are work. `Later` is a list of ideas: to start one, add it to the queue
  as a `- [ ]` line and plan it.
- When a task is done, tick it and move it to `DONE` with the date.


Current queue:


## Later — not queued

Ideas from the product concept and plan `001`'s out-of-scope list, ranked for a study project under A9 (cost first,
local only). Each one needs its own plan before it's queued.

| Idea | Stack | Cost and notes |
|---|---|---|
| github oauth login | full | $0. The fast-follow for auth (plan `001`, Q3). |
| password reset and email verification | full | $0 when mail goes to a local catcher such as Mailpit in `compose.yaml`; no email provider needed. |
| spaced repetition for missed quiz items | full | $0. Scheduling only, no AI calls. |
| account export and delete | full | $0. The data model already soft-deletes; this adds an export endpoint and the UI. |
| adaptive quiz difficulty | full | Small AI cost: the generation prompt takes the user's recent scores. |
| free-text quiz answers graded by AI | full | One AI call per answer, and grading stops being deterministic. Conflicts with A9. |
| run code snippets in a sandbox | full | A security project of its own: isolation, resource limits, untrusted input. High effort. |


## Won't do

Rejected for this project. They're listed so they aren't proposed again.
- Teams and classrooms (`org`): data is owned by a user (plan `001`, Q2).
- A hosted deployment: it runs locally only (Q11, A9).
- Payments, an admin console, i18n, a mobile app: there are no real users.


## DONE
- [x] Setup
- [x] ai tutor mvp: planned and split into phases P0–P6, plan `001` (2026-10-06)
- [x] p0 foundation | stack:full | plan:001 (2026-10-07)
- [x] p1 auth | stack:full | plan:001 (2026-10-07)
- [x] p2 ask and explain | stack:full | plan:001 (2026-10-07)
- [x] p3 guidance | stack:full | plan:001 (2026-10-07)
- [x] p4 quiz | stack:full | plan:001 (2026-10-07)
- [x] p5 progress | stack:full | plan:001 (2026-10-07)
- [x] p6 hardening | stack:full | plan:001 (2026-10-07)
- [x] backend module structure | stack:full | plan:002 (2026-10-07)
- [x] review hardening | stack:full | plan:003 (2026-10-07)
