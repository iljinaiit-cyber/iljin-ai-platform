import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("MULTIMODAL_MIME_TYPES includes audio and video types", async () => {
  const source = await readFile(new URL("lib/multimodal.ts", root), "utf8");
  const mimeTypes = source.match(/"([^"]+)"/g) || [];
  const all = mimeTypes.map((m) => m.replace(/"/g, ""));
  assert.ok(all.includes("audio/wav"), "audio/wav missing");
  assert.ok(all.includes("audio/mpeg"), "audio/mpeg missing");
  assert.ok(all.includes("audio/flac"), "audio/flac missing");
  assert.ok(all.includes("video/mp4"), "video/mp4 missing");
  assert.ok(all.includes("video/webm"), "video/webm missing");
  assert.ok(all.includes("video/x-matroska"), "video/x-matroska missing");
});

test("RagCitation.sourceType includes audio and video", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  assert.match(source, /sourceType\??: "document" \| "image" \| "audio" \| "video"/);
});

test("RagQueryPlan.modality includes audio and video", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  assert.match(source, /modality: "text" \| "image" \| "table" \| "chart" \| "audio" \| "video" \| "multimodal"/);
});

test("planRagQuery detects audio modality", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  assert.match(source, /wantsAudio\s*=\s*\/\(.*음성.*오디오.*녹음.*audio.*\)/i);
});

test("planRagQuery detects video modality", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  assert.match(source, /wantsVideo\s*=\s*\/\(.*영상.*동영상.*비디오.*video.*\)/i);
});

test("segments INSERT includes time_start_ms, time_end_ms, speaker, modality", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  const insertMatches = [...source.matchAll(/INSERT INTO segments/g)];
  assert.ok(insertMatches.length >= 3, `expected >=3 INSERT INTO segments, got ${insertMatches.length}`);
  for (const [i, match] of insertMatches.entries()) {
    const after = source.slice(match.index ?? 0, (match.index ?? 0) + 500);
    assert.ok(after.includes("time_start_ms"), `INSERT #${i} missing time_start_ms`);
    assert.ok(after.includes("time_end_ms"), `INSERT #${i} missing time_end_ms`);
    assert.ok(after.includes("speaker"), `INSERT #${i} missing speaker`);
    assert.ok(after.includes("modality"), `INSERT #${i} missing modality`);
  }
});

test("segments schema is preflighted before multimodal inserts", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  const columns = source.match(/segments: \[[^\]]*\]/)?.[0] || "";
  for (const column of ["time_start_ms", "time_end_ms", "speaker", "modality", "vector_indexed_at"]) {
    assert.match(columns, new RegExp(`"${column}"`));
  }
  assert.match(source, /D1_SCHEMA_OUTDATED/);
  assert.doesNotMatch(source, /CREATE TABLE IF NOT EXISTS segments/);
});

test("ALLOWED_RAG_MIME_TYPES includes audio and video", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  const mimeMatch = source.match(/ALLOWED_RAG_MIME_TYPES\s*=\s*new Set\(\[[\s\S]*?\]\)/);
  assert.ok(mimeMatch, "ALLOWED_RAG_MIME_TYPES not found");
  const mimeBlock = mimeMatch[0];
  assert.ok(mimeBlock.includes("audio/wav"), "allowedMimeTypes missing audio/wav");
  assert.ok(mimeBlock.includes("audio/mpeg"), "allowedMimeTypes missing audio/mpeg");
  assert.ok(mimeBlock.includes("video/mp4"), "allowedMimeTypes missing video/mp4");
});

test("deleteAsset deletes visual_regions and cascades R2 prefix", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  const deleteMatch = source.match(/export async function deleteAsset[\s\S]*?^}/m);
  assert.ok(deleteMatch, "deleteAsset not found");
  const fn = deleteMatch[0];
  assert.ok(fn.includes("DELETE FROM visual_regions"), "deleteAsset missing visual_regions cleanup");
  assert.ok(fn.includes("r2.list"), "deleteAsset missing R2 prefix listing");
  assert.ok(fn.includes("prefix"), "deleteAsset missing prefix-based deletion");
});

test("bbox_json column is nullable in schema and DDL", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  const ddlMatch = source.match(/bbox_json[^,]*/);
  assert.ok(ddlMatch, "bbox_json not found in DDL");
  assert.ok(!ddlMatch[0].includes("NOT NULL"), "bbox_json should be nullable");
});

test("visual_regions bbox is nullable in MultimodalAnalysis type", async () => {
  const source = await readFile(new URL("lib/multimodal.ts", root), "utf8");
  assert.match(source, /bbox: \[number, number, number, number\] \| null/);
  assert.match(source, /bbox: null/);
});

test("DocumentIngest accepts audio and video files", async () => {
  const source = await readFile(new URL("app/components/DocumentIngest.tsx", root), "utf8");
  assert.match(source, /\.(wav|mp3|flac|ogg|m4a|webm|mp4|mov|avi|mkv|mpeg)/i);
  assert.match(source, /audio\/\*/);
  assert.match(source, /video\/\*/);
});

test("DocumentIngest strips any extension from title, including audio/video", async () => {
  const source = await readFile(new URL("app/components/DocumentIngest.tsx", root), "utf8");
  // 확장자를 나열하는 대신 마지막 .확장자를 통째로 잘라내는 일반형 정규식을 쓴다 —
  // wav/mp4 뿐 아니라 새 포맷이 추가돼도 목록을 매번 늘릴 필요가 없다.
  const regexMatch = source.match(/\.replace\(\/\\\.\[\^\.\]\+\$\//);
  assert.ok(regexMatch, "generic title strip regex not found");
});

test("RagResults renders audio and video players", async () => {
  const source = await readFile(new URL("app/components/RagResults.tsx", root), "utf8");
  assert.ok(source.includes("<audio"), "RagResults missing <audio> element");
  assert.ok(source.includes("<video"), "RagResults missing <video> element");
  assert.ok(source.includes("mediaFragmentUrl"), "RagResults missing mediaFragmentUrl helper");
});

test("AgentPortal maps audio/video sourceType in citations", async () => {
  const source = await readFile(new URL("app/AgentPortal.tsx", root), "utf8");
  assert.match(source, /citation\.sourceType === "audio"/);
  assert.match(source, /citation\.sourceType === "video"/);
});
