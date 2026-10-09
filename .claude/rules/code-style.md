# Code Style

Applies to every JavaScript and TypeScript file in this repository.

- No trailing semicolons.
- When a semicolon is required for syntax safety, put it at the start of the line.

```js
const value = getValue()
;(() => init())()
```

## Branching
- Three or more `if` / `else if` branches, or a `switch`, on one discriminator
  become a lookup: a `Record`, or a `Map` when the keys come from outside input
  (a plain object also answers `toString` and `__proto__`).
- When the branches guard several unrelated conditions, the table form is an
  ordered rule list where the first match wins (`ERROR_MATCHERS` in
  `backend/src/middleware/error.ts`).

```ts
type StopReason = 'refusal' | 'max_tokens' | 'end_turn'

// before
if (reason === 'refusal') status = 'failed'
else if (reason === 'max_tokens') status = 'incomplete'
else if (reason === 'end_turn') status = 'complete'

// after
const STATUS_BY_STOP_REASON: Record<StopReason, Status> = {
  refusal: 'failed', max_tokens: 'incomplete', end_turn: 'complete'
}
const status = STATUS_BY_STOP_REASON[reason]
```

`StopReason` here is exactly those three values. A `Record` over a union must
name every member, so a member added to the union fails to compile until the
table gets its entry: that is the point of the pattern.

## Backend layers
- A `route.ts` is a declarative table only: imports, `validateX` and limiter
  constants, one `router.verb(...)` line per route, `export default router`.
- A controller reads its own module's services through `servicesOf(req)`,
  anything else through `ctxOf(req)`, and shapes the HTTP response. No SQL, no
  domain branching.
- A service holds the rules.

Match the surrounding code for everything this file does not cover.
