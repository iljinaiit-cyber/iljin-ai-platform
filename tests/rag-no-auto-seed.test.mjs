import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../lib/rag.ts", import.meta.url), "utf8");

test("RAG search never creates sample documents automatically", () => {
  assert.doesNotMatch(source, /requirements-seed|ensureSeedCorpus|seedDocuments/);
  const search = source.match(/export async function searchRag[\s\S]*?export async function completeWithRag/)?.[0] || "";
  assert.match(search, /await ensureRagSchema\(\)/);
});

test("deleted assets do not remain in the index-job list", () => {
  const list = source.match(/export async function listIndexJobs[\s\S]*?\n}/)?.[0] || "";
  assert.match(list, /a\.deleted_at IS NULL/);
});
