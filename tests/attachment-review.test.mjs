import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("답변 생성 중에는 실제 첨부 파일의 검토 상태를 표시한다", async () => {
  const [portal, css] = await Promise.all([
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(portal, /streaming && conversationAttachments\.length > 0/);
  assert.match(portal, /첨부 문서 검토 중/);
  assert.match(portal, /attachment\.title/);
  assert.match(portal, /attachment\.segment_count/);
  assert.match(css, /\.attachment-review-panel/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
