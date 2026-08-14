import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("keeps Iljin Global company identity consistent across the system", async () => {
  const [profile, portal, gateway, layout, page, activity, internetSearch] = await Promise.all([
    source("lib/company-profile.ts"),
    source("app/AgentPortal.tsx"),
    source("lib/llm-gateway.ts"),
    source("app/layout.tsx"),
    source("app/page.tsx"),
    source("lib/activity.ts"),
    source("lib/internet-search.ts"),
  ]);

  assert.match(profile, /일진글로벌/);
  assert.match(profile, /베어링 전문 제조 기업/);
  assert.match(profile, /일진.*1순위/);
  assert.doesNotMatch(portal, /COMPANY_DESCRIPTION/);
  assert.match(portal, /업무 예시/);
  assert.doesNotMatch(portal, /일진글로벌 베어링 업무 예시/);
  assert.match(gateway, /COMPANY_PROFILE_INSTRUCTION/);
  assert.doesNotMatch(layout, /COMPANY_DESCRIPTION/);
  assert.doesNotMatch(page, /COMPANY_DESCRIPTION/);
  assert.doesNotMatch(portal, /일진글로벌은 베어링 전문 제조 기업입니다/);
  assert.doesNotMatch(layout, /일진글로벌은 베어링 전문 제조 기업입니다/);
  assert.doesNotMatch(page, /일진글로벌은 베어링 전문 제조 기업입니다/);
  assert.match(activity, /베어링 제조 업무에 적용할 수 있는/);
  assert.match(internetSearch, /베어링 제조 최신 기술 동향/);
  assert.match(internetSearch, /prioritizeCompanySearchQuery/);
});
