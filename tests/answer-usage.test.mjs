import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("답변 하단에 총 토큰과 생성 경과 시간을 표시한다", async () => {
  const portal = await readFile(new URL("app/AgentPortal.tsx", root), "utf8");

  assert.match(portal, /usage\?: \{ prompt_tokens\?: number; completion_tokens\?: number; total_tokens\?: number \}/);
  assert.match(portal, /tokenCount: payload\.usage\?\.total_tokens/);
  assert.match(portal, /사용 토큰/);
  assert.match(portal, /경과 시간/);
  assert.match(portal, /message\.latencyMs \/ 1_000/);
});
