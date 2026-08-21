import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

test("admin and agent schema guards are read-only migration preflights", async () => {
  const files = [
    "lib/admin-governance.ts",
    "lib/organization.ts",
    "lib/token-usage.ts",
    "lib/agent-orchestrator.ts",
    "lib/chat-agents.ts",
  ];
  for (const file of files) {
    const source = await read(file);
    assert.match(source, /verifyD1Schema\(/, `${file} must verify a migrated schema`);
    assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX)\b/i, `${file} must not mutate D1 schema at runtime`);
  }
});

test("admin and agent schema baseline and guarded history reconciliation are versioned", async () => {
  const [migration, reconciliation] = await Promise.all([
    read("drizzle/0029_admin_agent_schema_baseline.sql"),
    read("scripts/d1-production-history-reconciliation.sql"),
  ]);
  for (const name of ["scoped_permission_policies", "user_token_allocations", "corporations", "departments", "tool_registry"]) {
    assert.match(migration, new RegExp(name), `0029 must define ${name}`);
  }
  assert.match(migration, /INSERT OR IGNORE INTO tool_registry/, "tool seeds must be migration data");
  assert.match(reconciliation, /BEGIN IMMEDIATE;/);
  assert.match(reconciliation, /0029_admin_agent_schema_baseline\.sql/);
  assert.doesNotMatch(reconciliation, /CREATE\s+TABLE/i, "history reconciliation must only mark verified history");
});
