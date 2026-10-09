# Naming

Applies to API routes, domain entities, services, files, data fields, and to
variables, parameters, properties, state and functions.

- Prefer **singular** entity names: `site.service`, `/api/site`, `/api/post`.
- Use the canonical short term, never a synonym:
  - `org` — not `organization`
  - `geo` — not `geolocation` or `localization`
  - `lat` / `lng` — for coordinates
- Keep route and file names aligned with the domain name they serve.
- Do not introduce a second word for a concept that already has one. Canonical
  terms live in `.doc/glossary.md`; document a new shared term there before
  using it broadly.

## Booleans
- Boolean variables, parameters, properties and fields, React state and refs,
  and functions that return a boolean start with `is`, `has`, `can`, `should`,
  `was`, `did` or `does`.
- API wire fields follow the rule: `isDone`, `isHintRevealed`, `isCorrect`,
  `isActiveToday`.
- Exempt: a name forwarded verbatim to a DOM attribute or a library option
  (`disabled`, `autoFocus`, react-query `enabled`), environment variable names,
  and third-party option keys.

```ts
// bad
const [open, setOpen] = useState(false)
function passwordMatches(hash: string, password: string): Promise<boolean>
type Step = { done: boolean }

// good
const [isOpen, setIsOpen] = useState(false)
function doesPasswordMatch(hash: string, password: string): Promise<boolean>
type Step = { isDone: boolean }
```

## Backend files
- `backend/src/api/<m>/` — one HTTP module: `route.ts`, `controller.ts`,
  `service.ts`, `validation.ts` (when the module takes input), `index.ts`.
- A second file of one role gets a sub-resource prefix: `session.service.ts`,
  `message.service.ts`. Any other helper is named for what it holds
  (`stale-turn.ts`).
- `backend/src/services/<s>/` — a domain service with no HTTP (`ai`).
- `backend/src/middleware/` — Express middleware. `backend/src/lib/` —
  infrastructure.
