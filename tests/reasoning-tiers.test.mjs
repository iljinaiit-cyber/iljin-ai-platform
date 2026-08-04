import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("llm-gateway exports ReasoningTier type", async () => {
  const source = await readFile(new URL("lib/llm-gateway.ts", root), "utf8");
  assert.match(source, /export type ReasoningTier\s*=\s*"swift" \| "expert" \| "deep"/);
});

test("safeMessages is tier-aware with three system prompts", async () => {
  const source = await readFile(new URL("lib/llm-gateway.ts", root), "utf8");
  assert.match(source, /tierAdditions.*Record<ReasoningTier, string>/);
  assert.match(source, /swift:.*즉시 답합니다/);
  assert.match(source, /expert:[\s\S]*한 줄 요약/);
  assert.match(source, /deep:[\s\S]*교차 검증/);
  assert.match(source, /심층 의사결정 문서/);
  assert.match(source, /문서 골격 또는 목차 표/);
  assert.match(source, /예상 질문·반론 대비/);
  assert.match(source, /\[자사 데이터 입력\]/);
});

test("completeWithGateway accepts reasoningTier parameter", async () => {
  const source = await readFile(new URL("lib/llm-gateway.ts", root), "utf8");
  assert.match(source, /completeWithGateway[\s\S]*?reasoningTier\?.*ReasoningTier/);
});

test("rag.ts exports ReasoningTier type", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  assert.match(source, /export type ReasoningTier\s*=\s*"swift" \| "expert" \| "deep"/);
});

test("completeWithRag accepts reasoningTier and preserves conversation history", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  assert.match(source, /reasoningTier\?.*ReasoningTier/);
  assert.match(source, /recentUserTurns/);
  assert.match(source, /retrievalQuery/);
  assert.match(source, /conversationHistory/);
  assert.match(source, /historyBlock/);
  assert.match(source, /tierInstructions/);
});

test("completeWithRag runs post-hoc citation verification", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  assert.match(source, /verifyCitations/);
  assert.match(source, /annotateCitationIssues/);
  assert.match(source, /citationReport/);
});

test("citation-guard.ts exists with verifyCitations and annotateCitationIssues", async () => {
  const source = await readFile(new URL("lib/citation-guard.ts", root), "utf8");
  assert.match(source, /export function verifyCitations/);
  assert.match(source, /export function annotateCitationIssues/);
  assert.match(source, /phantom_citation/);
  assert.match(source, /uncited_claim/);
  assert.match(source, /unsupported_claim/);
  assert.match(source, /MIN_OVERLAP_RATIO/);
});

test("chat completions route accepts reasoning_tier", async () => {
  const source = await readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8");
  assert.match(source, /reasoning_tier/);
  assert.match(source, /reasoningTier/);
});

test("maxOutputTokensFor scales with reasoning tier", async () => {
  const source = await readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8");
  assert.match(source, /maxOutputTokensFor.*length.*tier/);
  assert.match(source, /tierBoost.*deep.*1\.5/);
});

test("deep RAG answers require actionable structure, metrics, governance, and next steps", async () => {
  const [rag, route] = await Promise.all([
    readFile(new URL("lib/rag.ts", root), "utf8"),
    readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8"),
  ]);
  assert.match(rag, /목차 골격이나 구조표/);
  assert.match(rag, /단계별 게이트/);
  assert.match(rag, /정량 KPI와 검증 주체/);
  assert.match(route, /설계 기준 → 전체 구조 또는 비교표/);
  assert.match(route, /리스크·거버넌스 → 예상 반론 → 다음 행동/);
});

test("AgentPortal maps answer length to reasoning tier in API request", async () => {
  const source = await readFile(new URL("app/AgentPortal.tsx", root), "utf8");
  assert.match(source, /reasoning_tier/);
  assert.match(source, /chatAnswerLength === "brief" \? "swift"/);
  assert.match(source, /chatAnswerLength === "detailed" \? "deep"/);
});

test("AgentPortal answer length label is '답변 분량'", async () => {
  const source = await readFile(new URL("app/AgentPortal.tsx", root), "utf8");
  assert.match(source, /답변 분량/);
  assert.doesNotMatch(source, /모델 수준/);
});
