import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../lib/rag.ts", import.meta.url), "utf8");

test("RAG schema preflight covers every runtime-owned table and budget columns", () => {
  for (const table of ["assets", "segments", "index_jobs", "retrieval_traces", "visual_regions", "visual_embeddings", "ingestion_sources"]) {
    assert.match(source, new RegExp(`${table}: \\[`));
  }
  for (const column of ["deferred_until", "resume_offset", "last_error_code", "visual_search_enabled", "chart_json"]) {
    assert.match(source, new RegExp(`"${column}"`));
  }
});

test("RAG request handling does not execute schema DDL", () => {
  const preflight = source.match(/export async function ensureRagSchema\(\)[\s\S]*?\r?\n}\r?\n\r?\nfunction normalizeText/)?.[0] || "";
  assert.doesNotMatch(preflight, /CREATE TABLE|ALTER TABLE|CREATE INDEX/);
  assert.match(preflight, /PRAGMA table_info/);
  assert.match(preflight, /D1_SCHEMA_OUTDATED/);
});
