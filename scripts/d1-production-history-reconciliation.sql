-- One-time production baseline reconciliation. This file is deliberately outside
-- drizzle/ so `wrangler d1 migrations apply` never runs it implicitly.
--
-- Preconditions (all required):
-- 1. A read-only schema check proves that the complete 0029 baseline already exists,
--    including expected user_profiles columns and built-in tool_registry rows.
-- 2. `d1_migrations` contains the verified 0000 through 0028 history, but not 0029.
-- 3. The change is separately approved for the exact production database.
--
-- The production runbook must execute this file only after those checks. It marks
-- the already-existing 0029 baseline as applied; it does not create application
-- tables or data.

BEGIN IMMEDIATE;

INSERT INTO d1_migrations (name)
SELECT '0029_admin_agent_schema_baseline.sql'
WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0029_admin_agent_schema_baseline.sql');

COMMIT;
