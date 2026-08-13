import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("답변 중단은 요청과 스트림을 취소하고 즉시 화면 상태를 정리한다", async () => {
  const portal = await readFile(new URL("app/AgentPortal.tsx", root), "utf8");

  assert.match(portal, /const chatStreamCancelRef = useRef/);
  assert.match(portal, /chatStreamCancelRef\.current = \(\) => \{ void reader\.cancel\(\); \}/);
  assert.match(portal, /chatAbortRef\.current = null;\s*chatStreamCancelRef\.current\?\.\(\);\s*chatStreamCancelRef\.current = null;\s*controller\.abort\(\);/);
  assert.match(portal, /if \(chatAbortRef\.current !== controller\) return;/);
  assert.match(portal, /if \(controller\.signal\.aborted\) throw new DOMException/);
  assert.match(portal, /setNotice\("AI 답변 생성을 중단했습니다\."\)/);
  assert.doesNotMatch(portal, /summary_only:\s*true/);
});
