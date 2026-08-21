import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("all pages receive reduced-motion-safe haptic and animation feedback", async () => {
  const [layout, feedback, styles] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/components/InteractionFeedback.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  assert.match(layout, /<InteractionFeedback \/>/);
  assert.match(feedback, /document\.addEventListener\("click", handleClick\)/);
  assert.match(feedback, /navigator\.vibrate\(8\)/);
  assert.match(feedback, /prefers-reduced-motion: reduce/);
  assert.match(styles, /@media \(prefers-reduced-motion: no-preference\)/);
  assert.match(styles, /@keyframes interaction-tap/);
});
