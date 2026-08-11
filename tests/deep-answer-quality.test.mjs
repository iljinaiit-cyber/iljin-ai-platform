import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("짧은 심층 인터넷 답변은 같은 근거로 한 번 보강 생성한다", async () => {
  const route = await readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8");

  assert.match(route, /MIN_DETAILED_INTERNET_BODY_CHARACTERS = 1_000/);
  assert.match(route, /function needsDetailedInternetExpansion/);
  assert.match(route, /expandShallowDetailedInternetAnswer/);
  assert.match(route, /internet-detailed-answer-repaired/);
  assert.match(route, /## 개요 및 핵심 요약/);
});
