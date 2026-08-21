import assert from "node:assert/strict";
import test from "node:test";
import { currentDateInstruction, hasOutdatedCurrentYearClaim, referenceDateInSeoul, withReferenceDateHeader } from "../lib/reference-date.ts";

test("uses the Seoul calendar date at the UTC year boundary without rewriting historical facts", () => {
  const boundary = new Date("2025-12-31T15:00:00.000Z");
  assert.match(referenceDateInSeoul(boundary), /^2026년 1월 1일$/);
  assert.match(currentDateInstruction(boundary), /2026년 이외의 연도를 '현재'로 표현하지 말고/);
  assert.match(withReferenceDateHeader("2025년 당시 도입 사례입니다.", boundary), /2025년 당시 도입 사례입니다\./);
});

test("rejects only past years presented as current", () => {
  const boundary = new Date("2025-12-31T15:00:00.000Z");
  assert.equal(hasOutdatedCurrentYearClaim("2025년 현재 AI 시장입니다.", boundary), true);
  assert.equal(hasOutdatedCurrentYearClaim("2025년 당시 AI 시장이었습니다.", boundary), false);
  assert.equal(hasOutdatedCurrentYearClaim("2026년 현재 AI 시장입니다.", boundary), false);
});
