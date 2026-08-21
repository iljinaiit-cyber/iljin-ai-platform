import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("RAG 후보 집합은 D1 바인딩 한도를 넘지 않는 JSON1 경로를 사용한다", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  assert.match(source, /s\.id IN \(SELECT value FROM json_each\(\?\)\)/);
  assert.match(source, /JSON\.stringify\(candidateIds\)/);
  assert.doesNotMatch(source, /candidateIds\.map\(\(\) => "\?"\)/);
});

test("Hybrid retrieval adds ACL-filtered FTS candidates before RRF reranking", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  assert.match(source, /FROM segments_fts/);
  assert.match(source, /segments_fts MATCH \?/);
  assert.match(source, /ORDER BY bm25\(segments_fts\)/);
  assert.match(source, /const lexicalCandidateIds = await queryLexicalCandidateIds/);
  assert.match(source, /\.\.\.lexicalCandidateIds,/);
  assert.match(source, /a\.department_scope/);
});

test("Visual regions are assigned to overlapping text chunks, not ingestion order", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  assert.match(source, /function segmentIndexForVisualRegion/);
  assert.match(source, /Math\.min\(chunk\.charEnd, end!/);
  assert.match(source, /segmentIds\[segmentIndexForVisualRegion\(chunks, region\)\]/);
  assert.doesNotMatch(source, /segmentIds\[Math\.min\(index, segmentIds\.length - 1\)\]/);
});

test("그래프 후보와 관계 증거는 최신 ACL 및 문서 상태를 검사한다", async () => {
  const source = await readFile(new URL("lib/ontology.ts", root), "utf8");
  assert.match(source, /ontology_relation_evidence/);
  assert.match(source, /proof_asset\.status = 'indexed'/);
  assert.match(source, /proof_asset\.deleted_at IS NULL/);
  assert.match(source, /proof_asset\.department_scope/);
  assert.match(source, /a\.document_status IS NULL OR a\.document_status = 'effective'/);
});

test("동기·큐·재색인·삭제 경로가 온톨로지 생명주기를 함께 관리한다", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  assert.ok((source.match(/indexSegmentOntology\(/g) || []).length >= 3);
  assert.ok((source.match(/removeAssetOntology\(/g) || []).length >= 4);
  assert.match(source, /seg_\$\{input\.assetId\}_\$\{offset \+ index\}/);
  assert.match(source, /ON CONFLICT\(id\) DO UPDATE/);
});

test("프로필 부서 변경과 큐 입력 검증 우회를 차단한다", async () => {
  const [identity, rag] = await Promise.all([
    readFile(new URL("lib/identity.ts", root), "utf8"),
    readFile(new URL("lib/rag.ts", root), "utf8"),
  ]);
  assert.match(identity, /requestedDepartment !== existing\.department/);
  assert.match(identity, /관리자 또는 사내 인증 정보로만 변경/);
  assert.ok((rag.match(/validateIngestSecurityFields\(/g) || []).length >= 3);
});

test("사내 RAG 프롬프트는 ROOF 호환 블록과 Evidence·Constraints를 유지한다", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  for (const block of ["[ROLE]", "[OBJECTIVE]", "[OUTPUT]", "[FORMAT]", "[EVIDENCE RULES]", "[CONSTRAINTS]", "[EVIDENCE]", "[QUESTION]"]) {
    assert.ok(source.includes(block), `${block} missing`);
  }
  assert.match(source, /answerPreferenceInstruction\(input\.responsePreferences\.length, input\.responsePreferences\.format, currentQuestion\)/);
});
