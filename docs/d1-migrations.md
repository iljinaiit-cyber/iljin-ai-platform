# D1 migrations

`drizzle/` contains only SQL migrations and `drizzle/meta/` contains only Drizzle Kit JSON metadata.
Cloudflare D1 records applied SQL filenames in its `d1_migrations` table. Before adding a migration, compare that remote history with the repository and back up the target database.

The production database was verified on 2026-08-20 to have applied `0000` through `0028`, including both independently named `0021` and `0026` files. Its physical schema already contains the objects recorded in the new `0029` baseline. Future D1 changes must be a new, uniquely numbered SQL file and must not be created by runtime request handling.

## Production history reconciliation

The 2026-08-20 production journal is complete through `0028`, while its physical schema already has the `0029` baseline objects created by previous request-time bootstraps. Do **not** run `wrangler d1 migrations apply --remote` for `0029`: its idempotent table/index statements are safe, but SQLite cannot conditionally add the three existing `user_profiles` columns.

For the known production journal that contains only `0000` through `0004`, use this controlled sequence after separate production-change approval:

1. Export the production schema without data and inspect `PRAGMA table_info` for the `0029` objects, including `user_profiles.corp_id`, `user_profiles.dept_id`, `user_profiles.job_title`, and the built-in `tool_registry` rows. Confirm `d1_migrations` has exactly `0000`–`0028` and no `0029` entry.
2. Back up the schema/export artefact outside the deployment workspace.
3. Execute [`scripts/d1-production-history-reconciliation.sql`](../scripts/d1-production-history-reconciliation.sql) explicitly with `wrangler d1 execute ... --remote --file`; this file only records the verified, pre-existing `0029` baseline and is intentionally outside `drizzle/`.
4. Run `wrangler d1 migrations list ... --remote` and a second read-only schema check. It must report no unapplied migration and no unexpected schema mismatch before deploying application code.

If any verification fails, stop. Do not mark migrations as applied, do not edit historical migration files, and create a forward-only corrective migration after taking a fresh schema export.

## 0030 Hybrid retrieval and visual locators

`0030_hybrid_fts_and_visual_locators.sql` adds the `segments_fts` FTS5 external-content index, synchronization triggers, and nullable `visual_regions.char_start` / `char_end` locators. Apply it **before** deploying the RAG code that requires this schema.

1. Complete the `0029` reconciliation above when the target database has the known historical journal state.
2. Back up the target schema, then apply the forward-only migration with `npx wrangler d1 migrations apply iljin-ai-db --remote --env production` from `web-app`.
3. Confirm `segments_fts` and its three `segments_fts_a*` triggers exist in `sqlite_master`, and `PRAGMA table_info(visual_regions)` returns `char_start` and `char_end`.
4. Run `npm run typecheck`, the RAG regression tests, and a live identifier-query smoke test before application deployment.

Do not apply `0030` twice through a manual SQL execution path: the D1 migration journal is the source of truth for this forward-only change.
