import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("structured chart extraction keeps only numbers present in OCR evidence", async () => {
  const source = await readFile(new URL("lib/multimodal.ts", root), "utf8");
  assert.match(source, /export function parseStructuredChartData/);
  assert.match(source, /Copy only values explicitly visible in the supplied evidence/);
  assert.match(source, /Never interpolate, calculate, normalize, or infer missing values/);
});

test("visual search persists Cohere vectors separately and only for opted-in documents", async () => {
  const [rag, visual] = await Promise.all([
    readFile(new URL("lib/rag.ts", root), "utf8"),
    readFile(new URL("lib/visual-embeddings.ts", root), "utf8"),
  ]);
  assert.match(visual, /embed-v4\.0/);
  assert.match(visual, /COHERE_API_KEY/);
  assert.match(visual, /DISABLED_AI_KINDS/);
  assert.match(visual, /visual_search/);
  assert.match(visual, /\/cohere\/v2\/embed/);
  assert.match(visual, /input_type: inputType/);
  assert.match(visual, /MAX_VISUAL_EMBEDDING_BYTES/);
  assert.match(rag, /visual_embeddings: \[[^\]]*"id"[^\]]*"asset_id"[^\]]*"segment_id"[^\]]*"embedding_model"/);
  assert.match(rag, /D1_SCHEMA_OUTDATED/);
  assert.match(rag, /VISUAL_VECTOR_INDEX/);
  assert.match(rag, /upsertVisualVectors/);
  assert.match(rag, /queryVisualVectorScores/);
  assert.match(rag, /queryVisualSegmentScores/);
  assert.match(rag, /visualSegmentScores\.keys\(\)/);
  assert.match(rag, /visual_search_enabled/);
  assert.match(rag, /input\.visualSearchEnabled/);
  assert.match(rag, /chart_json/);
});
