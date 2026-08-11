import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("answer feedback is persisted and turned into a user learning signal", async () => {
  const [portal, feedbackRoute, memory, conversations, chatRoute, rag] = await Promise.all([
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/api/v1/messages/[id]/feedback/route.ts", root), "utf8"),
    readFile(new URL("lib/user-memory.ts", root), "utf8"),
    readFile(new URL("lib/conversations.ts", root), "utf8"),
    readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8"),
    readFile(new URL("lib/rag.ts", root), "utf8"),
  ]);

  assert.match(portal, /answer-feedback-button/);
  assert.match(portal, /답변 좋아요/);
  assert.match(portal, /답변 싫어요/);
  assert.match(feedbackRoute, /recordMessageFeedback/);
  assert.match(memory, /feedbackLearning/);
  assert.match(memory, /buildFeedbackLearningContext/);
  assert.match(conversations, /FROM message_feedback f/);
  assert.match(chatRoute, /buildFeedbackLearningContext/);
  assert.match(rag, /learningContext/);
});
