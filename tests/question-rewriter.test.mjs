import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("question-rewriter.ts exists with key functions", async () => {
  const source = await readFile(new URL("lib/question-rewriter.ts", root), "utf8");
  assert.match(source, /export function extractFollowUpQuestions/);
  assert.match(source, /export async function rewriteQuery/);
  assert.match(source, /export async function generateInsufficiencyQuestions/);
  assert.match(source, /FOLLOW_UP_INSTRUCTION/);
});

test("extractFollowUpQuestions parses ## 보충 질문 section", async () => {
  const source = await readFile(new URL("lib/question-rewriter.ts", root), "utf8");
  assert.match(source, /## 보충 질문/);
  assert.match(source, /FollowUpQuestion/);
});

test("FOLLOW_UP_INSTRUCTION contains format guidance", async () => {
  const source = await readFile(new URL("lib/question-rewriter.ts", root), "utf8");
  assert.match(source, /보충 질문/);
  assert.match(source, /질문 목적/);
});

test("rag.ts imports from question-rewriter", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  assert.match(source, /from "\.\/question-rewriter"/);
  assert.match(source, /rewriteQuery|generateInsufficiencyQuestions|FOLLOW_UP_INSTRUCTION/);
});

test("rag.ts generates follow-up questions when evidence is insufficient", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  assert.match(source, /generateInsufficiencyQuestions/);
  assert.match(source, /followUpQuestions/);
});

test("rag.ts prompt includes follow-up question instruction", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  assert.match(source, /보충 질문/);
});

test("chat route imports extractFollowUpQuestions", async () => {
  const source = await readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8");
  assert.match(source, /extractFollowUpQuestions/);
  assert.match(source, /needsColdStartClarification/);
  assert.match(source, /defaultClarificationQuestions/);
  assert.match(source, /clarificationSuggestionsOnly/);
  assert.match(source, /COLD_START_CLARIFICATION_LEAD_IN/);
  assert.match(source, /rewriteQuery/);
  assert.match(source, /const internetQuery/);
  assert.match(source, /context: internetContext/);
  assert.match(source, /follow_up_questions/);
});

test("internet search plan separates intent from freshness", async () => {
  const source = await readFile(new URL("lib/internet-search.ts", root), "utf8");
  assert.match(source, /intent: InternetSearchIntent/);
  assert.match(source, /COMPARISON_PATTERN\.test\(searchQuery\)/);
  assert.match(source, /HOW_TO_PATTERN\.test\(searchQuery\)/);
  assert.match(source, /RESEARCH_PATTERN\.test\(searchQuery\)/);
  assert.match(source, /intent === "research"/);
  assert.match(source, /intent === "comparison"/);
  assert.match(source, /intent === "how-to"/);
});

test("chat route shares one done object with follow_up_questions across streaming and non-streaming responses", async () => {
  const source = await readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8");
  assert.match(source, /follow_up_questions: allFollowUps/);
  assert.match(source, /sse\("done", done\)/);
  assert.match(source, /ok\(\{ \.\.\.done, content: completion\.content, citations \}, traceId\)/);
});

test("llm-gateway imports FOLLOW_UP_INSTRUCTION", async () => {
  const source = await readFile(new URL("lib/llm-gateway.ts", root), "utf8");
  assert.match(source, /FOLLOW_UP_INSTRUCTION/);
});

test("llm-gateway expert prompt includes follow-up question instruction", async () => {
  const source = await readFile(new URL("lib/llm-gateway.ts", root), "utf8");
  assert.match(source, /FOLLOW_UP_INSTRUCTION/);
});

test("AgentPortal ChatMessage type has followUpQuestions", async () => {
  const source = await readFile(new URL("app/AgentPortal.tsx", root), "utf8");
  assert.match(source, /followUpQuestions\?: FollowUpQuestion/);

});

test("AgentPortal renders follow-up question buttons", async () => {
  const source = await readFile(new URL("app/AgentPortal.tsx", root), "utf8");
  assert.match(source, /follow-up-questions/);
  assert.match(source, /follow-up-button/);
  assert.match(source, /정확한 답변을 위한 보충 질문/);
});

test("AgentPortal GatewayResponse has follow_up_questions field", async () => {
  const source = await readFile(new URL("app/AgentPortal.tsx", root), "utf8");
  assert.match(source, /follow_up_questions\?: FollowUpQuestion/);
});

test("AgentPortal streaming done handler captures follow_up_questions", async () => {
  const source = await readFile(new URL("app/AgentPortal.tsx", root), "utf8");
  assert.match(source, /done\.follow_up_questions/);
});

test("CSS has follow-up-button styles", async () => {
  const source = await readFile(new URL("app/globals.css", root), "utf8");
  assert.match(source, /\.follow-up-button/);
  assert.match(source, /\.follow-up-questions/);
  assert.match(source, /\.answer-divider/);
});

test("internal chat collects clarification answers before requesting the final answer", async () => {
  const [portal, route] = await Promise.all([
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8"),
  ]);
  assert.match(route, /clarification_required/);
  assert.match(route, /최종 답변을 생성하기 전에 확인이 필요한 정보/);
  assert.match(portal, /ClarificationForm/);
  assert.match(portal, /보충 정보를 제출했습니다/);
  assert.match(portal, /추가 정보가 꼭 필요하지 않다면 보충 질문을 반복하지 마세요/);
});

test("FormattedAnswer handles --- horizontal rule", async () => {
  const source = await readFile(new URL("app/AgentPortal.tsx", root), "utf8");
  assert.match(source, /answer-divider/);
  assert.match(source, /hr key/);
});

test("inlineAnswerContent parses markdown links", async () => {
  const source = await readFile(new URL("app/AgentPortal.tsx", root), "utf8");
  assert.match(source, /target="_blank"/);
  assert.match(source, /linkMatch/);
});
