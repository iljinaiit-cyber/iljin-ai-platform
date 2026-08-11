import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("answer format instructions define distinct paragraph, bullet, and table contracts", async () => {
  const source = await readFile(new URL("lib/answer-format.ts", root), "utf8");

  assert.match(source, /export type AnswerFormat/);
  assert.match(source, /문단형으로 작성하세요/);
  assert.match(source, /목록형으로 작성하세요/);
  assert.match(source, /표형으로 작성하세요/);
  assert.match(source, /answerPreferenceInstruction/);
  assert.match(source, /answerOutputTokenBudget/);
  assert.match(source, /answerReasoningTier/);
  assert.match(source, /inferAnswerFormat/);
  assert.match(source, /5~7개의 짧은 섹션/);
  assert.match(source, /3_600 : 1_800/);
  assert.match(source, /15년 차 수석 시장 분석가/);
  assert.match(source, /## 개요 및 핵심 요약/);
  assert.match(source, /## 주요 데이터 및 인사이트/);
  assert.match(source, /## 참고한 정보 출처 및 링크/);
});

test("chat routes share the same answer format contract", async () => {
  const [route, rag, gateway] = await Promise.all([
    readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8"),
    readFile(new URL("lib/rag.ts", root), "utf8"),
    readFile(new URL("lib/llm-gateway.ts", root), "utf8"),
  ]);

  assert.match(route, /answerPreferenceInstruction/);
  assert.match(route, /inferAnswerFormat/);
  assert.match(rag, /answerPreferenceInstruction/);
  assert.match(gateway, /지정된 형식을 끝까지 일관되게 유지/);
});

test("chat route derives reasoning tier from answer length when omitted", async () => {
  const source = await readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8");

  assert.match(source, /answerReasoningTier\(answerLength\)/);
  assert.match(source, /answerOutputTokenBudget/);
  assert.match(source, /reasoningTier,\r?\n/);
});
