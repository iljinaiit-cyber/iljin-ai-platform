import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("work examples start with a fresh chat context", async () => {
  const source = await readFile(new URL("../app/AgentPortal.tsx", import.meta.url), "utf8");
  const handler = source.match(/const startUseCaseConversation = async[\s\S]*?\n  };/)?.[0] || "";
  assert.match(handler, /await startNewConversation\(\)/);
  assert.match(handler, /setQuery\(prompt\)/);
  assert.match(handler, /navigate\("chat"\)/);
  assert.match(source, /새 대화로 시작하기/);
});
