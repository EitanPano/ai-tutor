-- Full bootstrap schema for a fresh database.
-- This file MUST change together with backend/db/migration/*.sql. The migration test
-- (tests/integration/migration.test.ts) fails when the two drift apart.

CREATE EXTENSION IF NOT EXISTS citext;
