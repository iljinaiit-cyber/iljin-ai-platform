import test from "node:test";
import assert from "node:assert/strict";
import { splitAnswerSummary } from "../lib/answer-format.ts";

test("빠른 요약에는 기준일 또는 검색 안내가 아닌 명시된 한 줄 요약만 표시한다", () => {
  const content = [
    "> 검색 및 접근 가능한 문서의 최신 확인 버전 기준",
    "",
    "> 기준일: 2026년 08월 21일 14:36 KST",
    "",
    "**한 줄 요약**: AI 에이전트와 멀티모달 활용이 산업 현장의 생산성 개선을 이끌고 있습니다.",
    "",
    "## 개요 및 핵심 요약",
    "근거 기반 본문입니다.",
  ].join("\n");

  const { summary, remainder } = splitAnswerSummary(content);

  assert.equal(summary, "AI 에이전트와 멀티모달 활용이 산업 현장의 생산성 개선을 이끌고 있습니다.");
  assert.match(remainder, /^> 검색 및 접근 가능한 문서의 최신 확인 버전 기준/m);
  assert.match(remainder, /^> 기준일:/m);
  assert.doesNotMatch(remainder, /한 줄 요약/);
});
