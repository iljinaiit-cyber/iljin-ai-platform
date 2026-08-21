import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("홈 배너는 데스크톱에서 141px 2행·인사말 한 줄이고 모바일에서 자동 높이로 전환한다", async () => {
  const css = await readFile(new URL("app/page-display.css", root), "utf8");

  assert.match(css, /grid-template-rows: minmax\(0, 1fr\) 34px/);
  assert.match(css, /min-height: 141px/);
  assert.match(css, /height: 141px/);
  assert.match(css, /grid-row: 1 \/ span 2/);
  assert.match(css, /\.workspace-home \.hero-copy h1[\s\S]*?white-space: nowrap/);
  assert.match(css, /\.workspace-home \.hero-copy h1 em[\s\S]*?display: inline/);
  assert.match(css, /@media \(max-width: 1080px\)[\s\S]*?\.workspace-home \.hero-panel[\s\S]*?height: auto/);
  assert.match(css, /@media \(max-width: 1080px\)[\s\S]*?\.workspace-home \.hero-copy h1[\s\S]*?white-space: normal/);
});
