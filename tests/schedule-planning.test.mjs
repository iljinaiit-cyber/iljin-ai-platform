import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("schedule work item insert keeps columns and bindings aligned", async () => {
  const source = await readFile(new URL("lib/schedule-planning.ts", root), "utf8");
  const insert = source.match(/INSERT INTO schedule_work_items\s*\(([^)]+)\)\s*VALUES \(([^)]+)\)/s);
  assert.ok(insert, "schedule work item insert should exist");
  assert.equal(insert[1].split(",").length, insert[2].split(",").length);
  assert.match(source, /await db\.batch\(\[workItemStatement, notificationStatement\]\)/);
});

test("schedule item API rejects titles shorter than the storage minimum", async () => {
  const source = await readFile(new URL("app/api/v1/schedule-items/route.ts", root), "utf8");
  assert.match(source, /body\.title\.trim\(\)\.length < 2/);
  assert.match(source, /업무 제목은 2~240자로 입력해 주세요/);
});
