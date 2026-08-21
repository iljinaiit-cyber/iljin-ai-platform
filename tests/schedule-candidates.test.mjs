import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("AI 답변은 일정 후보만 만들고 사용자가 확인할 때 저장한다", async () => {
  const [candidates, route, portal, chat] = await Promise.all([
    readFile(new URL("lib/schedule-candidates.ts", root), "utf8"),
    readFile(new URL("app/api/v1/schedule-candidates/route.ts", root), "utf8"),
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8"),
  ]);

  assert.match(candidates, /ownedAssistantMessage/);
  assert.match(candidates, /completeWithGateway/);
  assert.match(candidates, /conciseAutoWorkTitle/);
  assert.match(candidates, /Title must be a concise action phrase/);
  assert.match(candidates, /sourceType: "assistant_message"/);
  assert.match(route, /body\.candidate/);
  assert.match(portal, /AI 일정 후보/);
  assert.match(portal, /일정 추가/);
  assert.doesNotMatch(chat, /auto work registration|auto schedule registration/);
});

test("대화 삭제 시 AI 답변에서 등록한 일정도 함께 정리한다", async () => {
  const source = await readFile(new URL("lib/schedule-planning.ts", root), "utf8");
  assert.match(source, /source_type = 'assistant_message'/);
  assert.match(source, /source_id LIKE messages\.id \|\| ':%'/);
});
