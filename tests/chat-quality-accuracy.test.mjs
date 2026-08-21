import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("웹 검색 답변은 내부 RAG와 동일한 인용 검증 경고를 적용한다", async () => {
  const [route, guard] = await Promise.all([
    readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8"),
    readFile(new URL("lib/citation-guard.ts", root), "utf8"),
  ]);

  assert.match(route, /internet-citation-warning/);
  assert.match(route, /verifyCitations\(/);
  assert.match(route, /annotateCitationIssues/);
  assert.match(guard, /\(\?:S\|W\)/);
});

test("대화 요약은 사실·제약·결정·미해결 질문을 구조적으로 보존한다", async () => {
  const conversations = await readFile(new URL("lib/conversations.ts", root), "utf8");

  assert.match(conversations, /export type ConversationSummary/);
  assert.match(conversations, /facts: string\[\]/);
  assert.match(conversations, /constraints: string\[\]/);
  assert.match(conversations, /decisions: string\[\]/);
  assert.match(conversations, /openQuestions: string\[\]/);
  assert.match(conversations, /parseConversationSummary/);
  assert.match(conversations, /이 메모리의 확정 사실·제약을 임의로 바꾸지 말고/);
});

test("부정 평가는 오답 유형을 선택해 품질 학습 신호에 저장한다", async () => {
  const [portal, route, conversations, memory] = await Promise.all([
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/api/v1/messages/[id]/feedback/route.ts", root), "utf8"),
    readFile(new URL("lib/conversations.ts", root), "utf8"),
    readFile(new URL("lib/user-memory.ts", root), "utf8"),
  ]);

  assert.match(portal, /FeedbackReasonDialog/);
  assert.match(portal, /출처·근거 부족/);
  assert.match(portal, /질문 의도 오해/);
  assert.match(route, /reason\?: string/);
  assert.match(conversations, /INVALID_FEEDBACK_REASON/);
  assert.match(conversations, /reason TEXT/);
  assert.match(memory, /reason\?: string/);
});

test("웹 인용과 사용자 형식 제약을 화면과 프롬프트에 보존한다", async () => {
  const [portal, route] = await Promise.all([
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8"),
  ]);

  assert.doesNotMatch(portal, /if \(\/\^\\\[W\\d\+\\\]\$\/\.test\(part\)\) return null/);
  assert.match(portal, /aria-label="참고 출처"/);
  assert.match(portal, /https\?:\\\/\\\/\[\^\\s<\)\]\+/);
  assert.match(portal, /일정 후보 추출/);
  assert.doesNotMatch(portal, /void loadScheduleCandidates\(done\.message_id\)/);
  assert.match(route, /explicitRequestConstraintInstruction/);
  assert.match(route, /정확히 \$\{count\}개만 제시하세요/);
  assert.match(route, /비용·가격·단가 정보는 언급하지 마세요/);
  assert.match(route, /컨텍스트 윈도우, 최대 입력, 최대 출력은 서로 다른 지표/);
});
