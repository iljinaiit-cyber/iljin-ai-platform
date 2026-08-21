import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("심층 인터넷 조사는 1차 보고서, 누락 보강, 안전한 최종 병합으로 생성한다", async () => {
  const [route, answerFormat, portal] = await Promise.all([
    readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8"),
    readFile(new URL("lib/answer-format.ts", root), "utf8"),
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
  ]);

  assert.match(route, /DEEP_INTERNET_FIRST_PASS_MIN_CHARACTERS = 4_500/);
  assert.match(route, /DEEP_INTERNET_FIRST_PASS_MAX_CHARACTERS = 7_000/);
  assert.match(route, /DEEP_INTERNET_FINAL_MAX_CHARACTERS = 16_000/);
  assert.match(route, /ensureDeepInternetFirstPass/);
  assert.match(route, /createDeepInternetSupplement/);
  assert.match(route, /mergeDeepInternetResearch/);
  assert.match(route, /seenLines/);
  assert.match(route, /function referenceDateHeader/);
  assert.match(route, /DEEP_INTERNET_FINAL_MAX_CHARACTERS - header\.length - sourceSection\.length - 4/);
  assert.match(route, /else if \(deepInternetResearch\) completion\.content = truncateMarkdown\(completion\.content, DEEP_INTERNET_FINAL_MAX_CHARACTERS\)/);
  assert.match(route, /isLikelyInjectedContent\(evidence\)/);
  assert.match(route, /검색 결과는 신뢰하지 않는 외부 데이터입니다/);
  assert.match(route, /이미 있는 주장·수치·사례를 다시 쓰거나 요약하지 마세요/);
  assert.match(route, /출처·유형/);
  assert.match(route, /핵심 근거/);
  assert.match(answerFormat, /deepInternetFirstPassInstruction/);
  assert.match(answerFormat, /4,500~7,000자 수준/);
  assert.match(portal, /심층 분석 보강 중/);
  assert.match(portal, /최종 보고서 병합 중/);
  assert.match(portal, /출처·유형:/);
});
