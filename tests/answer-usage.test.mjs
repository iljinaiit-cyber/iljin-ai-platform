import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("답변 상태 레이블 옆에 총 토큰과 생성 경과 시간을 표시한다", async () => {
  const portal = await readFile(new URL("app/AgentPortal.tsx", root), "utf8");

  assert.match(portal, /usage\?: \{ prompt_tokens\?: number; completion_tokens\?: number; total_tokens\?: number \}/);
  assert.match(portal, /tokenCount: payload\.usage\?\.total_tokens/);
  assert.match(portal, /generationElapsedMs/);
  assert.match(portal, /토큰 계산 중/);
  assert.match(portal, /message\.latencyMs \?\? 0/);
  assert.match(portal, /message\.streamingResponse \? generationElapsedMs/);
  assert.match(portal, /typewriterQueue\.slice\(0, 2\)/);
  assert.match(portal, /typewriterQueue\.slice\(2\)/);
  assert.match(portal, /function GenerationProgress/);
  assert.match(portal, /답변 생성 진행 단계/);
  assert.match(portal, /검색 결과 교차 검토/);
  assert.match(portal, /GenerationProgress scope=\{searchScope\}/);
  assert.match(portal, /liveCitation = gatewayCitationToResult/);
});
