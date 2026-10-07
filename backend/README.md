# Backend

Express 5 + Kysely + Postgres. Configuration is documented in `.env.example`.

## Demo user and operator commands

From the repo root:

- `bun run db:seed` creates the demo user `demo@example.com` / `demo-password`
  (display name "Demo Developer", time zone UTC). It is idempotent and refuses to run when
  `NODE_ENV=production`.
- `bun run --filter backend user:reset-password <email>` sets a random 16-character password
  for that user, ends all of their sessions, and prints the temporary password once.
