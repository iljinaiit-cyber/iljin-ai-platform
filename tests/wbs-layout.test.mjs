import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("WBS keeps dates horizontal and projects with child work vertical", async () => {
  const [portal, styles] = await Promise.all([
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/page-display.css", root), "utf8"),
  ]);
  assert.match(portal, /const WBS_DAY_COUNT = 14/);
  assert.match(portal, /start\.getDate\(\) - \(\(start\.getDay\(\) \+ 6\) % 7\) \+ wbsStartOffset/);
  assert.match(portal, /const renderWbsProject/);
  assert.match(portal, /const renderWbsTask/);
  assert.match(portal, /schedule-wbs-header/);
  assert.match(portal, /이전 7일/);
  assert.match(portal, /const \[localSelectedWorkItemId, setLocalSelectedWorkItemId\]/);
  assert.match(portal, /schedule-work-detail/);
  assert.match(portal, /세부 업무 내용/);
  assert.match(portal, /편집<\/button>/);
  assert.match(portal, /schedule-planning-commandbar/);
  assert.match(styles, /schedule-planning-panel-wbs \{ max-width: none; \}/);
  assert.match(styles, /grid-template-columns: clamp\(220px, 24vw, 300px\) repeat\(14, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.schedule-wbs-project-row/);
  assert.match(styles, /\.schedule-wbs-task-track/);
  assert.match(styles, /\.modal-content\.schedule-work-detail \{ width: min\(680px, calc\(100vw - 32px\)\); min-width: min\(440px, calc\(100vw - 32px\)\); max-width: calc\(100vw - 32px\); height: min\(640px, calc\(100dvh - 48px\)\);/);
  assert.match(styles, /resize: both; overflow: auto;/);
  assert.match(styles, /\.schedule-work-detail-meta \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(portal, /const \[detailEditing, setDetailEditing\] = useState/);
  assert.match(portal, /editItem\(item, true\)/);
  assert.match(portal, /업무 정보 수정/);
  assert.match(portal, /변경 저장/);
  assert.match(styles, /schedule-filters button \{ flex: 0 0 auto; padding-inline: 10px; white-space: nowrap; \}/);
  assert.match(styles, /\.schedule-planning-commandbar \{ display: flex;/);
  assert.match(styles, /\.schedule-planning-commandbar \.schedule-filters button \{ flex: 0 0 auto; padding-inline: 10px; white-space: nowrap; \}/);
});
