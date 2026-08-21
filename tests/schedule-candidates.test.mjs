import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("AI 답변은 일정 후보만 만들고 사용자가 확인할 때 저장한다", async () => {
  const [candidates, route, portal, chat, styles] = await Promise.all([
    readFile(new URL("lib/schedule-candidates.ts", root), "utf8"),
    readFile(new URL("app/api/v1/schedule-candidates/route.ts", root), "utf8"),
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(candidates, /ownedAssistantMessage/);
  assert.match(candidates, /completeWithGateway/);
  assert.match(candidates, /rowid < \?/);
  assert.match(candidates, /scheduleAnswerChunks/);
  assert.match(candidates, /dedupeScheduleCandidates/);
  assert.match(candidates, /role: "assistant", content: `AI 답변/);
  assert.match(candidates, /conciseAutoWorkTitle/);
  assert.match(candidates, /간결한 단일 행동 문구/);
  assert.match(candidates, /sourceType: "assistant_message"/);
  assert.match(route, /body\.candidate/);
  assert.match(portal, /AI 일정 후보/);
  assert.match(portal, /scheduleCandidatesChecked/);
  assert.match(portal, /일정으로 등록할 행동 항목을 찾지 못했습니다/);
  assert.match(portal, /일정 추가/);
  assert.match(styles, /\.message > \.answer-actions,\s*\.message > \.schedule-candidates/);
  assert.match(styles, /\.message > \.answer-actions button\s*\{\s*white-space: nowrap/);
  assert.doesNotMatch(chat, /auto work registration|auto schedule registration/);
});

test("대화 삭제 시 AI 답변에서 등록한 일정도 함께 정리한다", async () => {
  const source = await readFile(new URL("lib/schedule-planning.ts", root), "utf8");
  assert.match(source, /source_type = 'assistant_message'/);
  assert.match(source, /source_id LIKE messages\.id \|\| ':%'/);
});
