// 관리자 콘솔 UI 와 서버 계약이 갈라지는 것을 막는다.
//
// 이 파일이 생긴 이유: AiControlTower 가 서버에 없는 status 어휘
// (partial/not_implemented/unknown)를 쓰고 증적을 evidence, 프레임워크를 source 로
// 읽고 있었다. 타입 오류도 린트 오류도 아니어서 빌드는 통과했고, 화면에서는
// 필드가 조용히 사라지고 내보내기 차단이 한 번도 걸리지 않았다.
// 이름이 어긋난 것은 실행해 보지 않으면 드러나지 않으므로 여기서 단정한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Control Tower UI 의 상태 어휘가 서버의 ControlStatus 와 일치한다", async () => {
  const [lib, ui] = await Promise.all([
    read("lib/control-tower.ts"),
    read("app/components/AiControlTower.tsx"),
  ]);

  const union = lib.match(/export type ControlStatus =([^;]+);/);
  assert.ok(union, "lib/control-tower.ts 에서 ControlStatus 정의를 찾지 못했습니다.");
  const serverStatuses = [...union[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();

  const labelBlock = ui.match(/const STATUS_LABEL[^{]*\{([^}]+)\}/);
  assert.ok(labelBlock, "AiControlTower.tsx 에서 STATUS_LABEL 을 찾지 못했습니다.");
  const uiStatuses = [...labelBlock[1].matchAll(/^\s*([a-z_]+)\s*:/gm)].map((m) => m[1]).sort();

  assert.deepEqual(uiStatuses, serverStatuses,
    `상태 어휘가 갈라졌습니다. 서버=${serverStatuses.join()} / UI=${uiStatuses.join()}`);
});

test("Control Tower UI 가 서버가 실제로 주는 필드명을 읽는다", async () => {
  const ui = await read("app/components/AiControlTower.tsx");
  // 서버는 evidenceNote·framework·referenceUrl·checkedAt 을 준다.
  for (const field of ["evidenceNote", "framework", "referenceUrl", "checkedAt", "ownerEmail", "dueDate"]) {
    assert.match(ui, new RegExp(`\\b${field}\\b`), `${field} 를 읽지 않습니다.`);
  }
  // 종전의 잘못된 이름이 되살아나지 않게 막는다.
  assert.doesNotMatch(ui, /control\.evidence\b/, "control.evidence 는 서버에 없는 필드입니다(evidenceNote).");
  assert.doesNotMatch(ui, /control\.source\b/, "control.source 는 서버에 없는 필드입니다(framework).");
  assert.doesNotMatch(ui, /control\.checked_at\b/, "control.checked_at 는 서버에 없는 필드입니다(응답 최상위 checkedAt).");
});

test("내보내기 차단은 서버가 계산한 gate 를 기준으로 한다", async () => {
  const ui = await read("app/components/AiControlTower.tsx");
  assert.match(ui, /gate\.status === "blocked"/,
    "차단 기준이 서버의 gate.status 가 아닙니다 — 서버가 내지 않는 상태를 세면 차단이 걸리지 않습니다.");
});

test("관리자 라우트는 오류 본문에 문자열이 아닌 객체를 담는다", async () => {
  // 화면은 전부 payload.error?.message 를 읽는다. error 에 문자열을 넣으면
  // 메시지가 undefined 가 되어 어떤 값이 잘못됐는지 사용자에게 전달되지 않는다.
  const base = new URL("app/api/admin/", root);
  const offenders = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const next = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) await walk(next);
      else if (entry.name === "route.ts") {
        const source = await readFile(next, "utf8");
        if (/ok\(\s*\{\s*error:\s*"/.test(source)) offenders.push(next.pathname);
      }
    }
  };
  await walk(base);
  assert.deepEqual(offenders, [], `오류 본문에 문자열을 담은 라우트: ${offenders.join(", ")}`);
});

test("수집 소스 등록은 로그인한 관리자를 생성자로 기록하고, 수동 실행은 같은 테넌트로 제한한다", async () => {
  const [route, rag, ui] = await Promise.all([
    read("app/api/admin/ingestion-sources/route.ts"),
    read("lib/rag.ts"),
    read("app/components/IngestionSources.tsx"),
  ]);

  assert.match(route, /created_by:\s*p\.email/, "수집 소스의 생성자가 서버에서 기록되지 않습니다.");
  assert.match(route, /runIngestionSource\(body\.id, getRuntimeEnv\(\), p\.tenantId\)/,
    "수동 수집이 요청자의 테넌트 범위로 제한되지 않습니다.");
  assert.match(rag, /tenant_id = \? AND enabled = 1/, "수동 수집의 테넌트 조건이 없습니다.");
  assert.match(ui, /database: form\.database\.trim\(\)/,
    "로컬 DB 소스가 서버가 요구하는 database 값을 보내지 않습니다.");
  assert.match(ui, /action: "run"/, "관리 화면에서 수동 수집을 실행할 수 없습니다.");
});

test("Control Tower 가 쓰는 통제 카드 클래스가 스타일시트에 존재한다", async () => {
  const [ui, css] = await Promise.all([read("app/components/AiControlTower.tsx"), read("app/globals.css")]);
  // className="..." 안의 control-* / release-gate / slo-* 클래스를 모은다.
  const used = new Set();
  for (const match of ui.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
    for (const token of (match[1] ?? match[2]).split(/[\s]+/)) {
      const name = token.replace(/\$\{[^}]*\}/g, "").trim();
      if (/^(control-|release-gate|slo-|critical-badge)/.test(name) && !name.endsWith("-")) used.add(name);
    }
  }
  assert.ok(used.size > 0, "검사할 클래스를 찾지 못했습니다.");
  const missing = [...used].filter((name) => !css.includes(`.${name}`));
  assert.deepEqual(missing, [], `스타일시트에 없는 클래스: ${missing.join(", ")}`);
});

test("조직·권한 화면의 변경 동작은 관리자 API에 실제로 연결된다", async () => {
  const [governanceUi, organizationUi, governanceRoute, organizationRoute, css] = await Promise.all([
    read("app/components/AdminGovernance.tsx"),
    read("app/components/OrgConsole.tsx"),
    read("app/api/admin/governance/route.ts"),
    read("app/api/admin/organization/route.ts"),
    read("app/globals.css"),
  ]);

  for (const action of ["role_permission", "feature", "user"]) {
    assert.match(governanceUi, new RegExp(`action: "${action}"`), `거버넌스 화면에 ${action} 저장 동작이 없습니다.`);
  }
  for (const action of ["create_corporation", "create_department", "update_corporation", "delete_corporation", "update_department", "delete_department", "assign_user"]) {
    assert.match(organizationUi, new RegExp(`"${action}"`), `조직 화면에 ${action} 동작이 없습니다.`);
    assert.match(organizationRoute, new RegExp(`case "${action}"`), `조직 API가 ${action}을 처리하지 않습니다.`);
  }
  assert.match(governanceRoute, /case "role_permission"/, "역할 정책 API가 없습니다.");
  for (const name of ["governance-workbench", "governance-table-wrap", "organization-workbench", "organization-members-surface"]) {
    assert.match(css, new RegExp(`\\.${name}`), `${name} 레이아웃 스타일이 없습니다.`);
  }
});

test("관리자 삭제는 확인 창과 서버 보호 규칙을 함께 사용한다", async () => {
  const [organizationUi, governanceUi, portal, organization, governance] = await Promise.all([
    read("app/components/OrgConsole.tsx"),
    read("app/components/AdminGovernance.tsx"),
    read("app/AgentPortal.tsx"),
    read("lib/organization.ts"),
    read("lib/admin-governance.ts"),
  ]);

  for (const source of [organizationUi, governanceUi, portal]) {
    assert.match(source, /window\.confirm\(/, "삭제 전에 확인 창을 표시하지 않습니다.");
  }
  assert.match(governanceUi, /action: "delete_user"/, "사용자 삭제 요청이 관리자 API에 연결되지 않았습니다.");
  assert.match(governance, /마지막 관리자는 삭제할 수 없습니다/, "마지막 관리자 삭제 보호가 없습니다.");
  assert.match(organization, /사용자가 배정된 부서는 삭제할 수 없습니다/, "사용자가 남은 부서 삭제 보호가 없습니다.");
  assert.match(organization, /부서 또는 사용자가 남아 있는 법인은 삭제할 수 없습니다/, "사용자가 남은 법인 삭제 보호가 없습니다.");
});

test("가입 승인은 사용자·조직·권한 관리 화면 안에서 처리한다", async () => {
  const [portal, css] = await Promise.all([read("app/AgentPortal.tsx"), read("app/globals.css")]);

  assert.match(portal, /\["management", "가입·조직·권한"\]/, "통합 사용자 관리 메뉴가 없습니다.");
  assert.match(portal, /activeSection === "management" && <>[\s\S]*management-access-review[\s\S]*admin-management-tab/,
    "가입 승인과 조직·권한 작업이 같은 관리 화면에 배치되지 않았습니다.");
  assert.match(portal, /admin-management[\s\S]*admin-governance-section/, "권한·기능 거버넌스가 조직 관리 아래에 배치되지 않았습니다.");
  assert.doesNotMatch(portal, /\["access", "가입 승인"\]/, "분리된 가입 승인 메뉴가 남아 있습니다.");
  assert.match(portal, /onSelect\("management"\).*가입 승인 대기/, "가입 승인 대기 항목이 통합 화면으로 이동하지 않습니다.");
  assert.match(css, /management-access-review/, "통합 승인 패널 스타일이 없습니다.");
});

test("사용자별 권한 표는 가입 대기 상태를 유지해 표시한다", async () => {
  const [ui, governance] = await Promise.all([read("app/components/AdminGovernance.tsx"), read("lib/admin-governance.ts")]);
  assert.match(ui, /status\?: "pending" \| "approved" \| "rejected"/, "사용자 응답 타입에 pending 상태가 없습니다.");
  assert.match(ui, /<option value="pending">가입 대기<\/option>/, "사용자별 권한 표에 가입 대기 상태가 없습니다.");
  assert.match(ui, /user\.status === "pending"/, "가입 대기 상태가 기본 승인 상태로 바뀝니다.");
  assert.match(governance, /status: "pending" \| "approved" \| "rejected"/, "관리자 저장 경로가 가입 대기 상태를 보존하지 않습니다.");
});

test("개인별 토큰 사용량과 관리 동작은 실제 사용 기록 및 관리자 API에 연결된다", async () => {
  const [ui, route, governance, telemetry, tokenUsage] = await Promise.all([
    read("app/components/AdminGovernance.tsx"),
    read("app/api/admin/governance/route.ts"),
    read("lib/admin-governance.ts"),
    read("lib/llm-telemetry.ts"),
    read("lib/token-usage.ts"),
  ]);

  assert.match(ui, /개인별 토큰 사용량 · 한도/, "관리자 화면에 개인별 토큰 관리 표가 없습니다.");
  for (const action of ["token_policy", "grant_tokens"]) {
    assert.match(ui, new RegExp(`action: "${action}"`), `${action} 화면 동작이 없습니다.`);
    assert.match(route, new RegExp(`case "${action}"`), `${action} API가 없습니다.`);
  }
  assert.match(governance, /listUserTokenUsage/, "거버넌스가 실제 사용자 토큰 사용량을 집계하지 않습니다.");
  assert.match(telemetry, /consumeUserTokens/, "LLM 실제 사용 토큰이 잔여 토큰에서 차감되지 않습니다.");
  assert.match(tokenUsage, /assertUserTokenAllowance/, "토큰 한도 사전 검사가 없습니다.");
});

test("조직·직급·개인 범위 권한은 실제 권한 판정과 관리자 화면에 함께 연결된다", async () => {
  const [ui, route, governance, identity] = await Promise.all([
    read("app/components/AdminGovernance.tsx"),
    read("app/api/admin/governance/route.ts"),
    read("lib/admin-governance.ts"),
    read("lib/identity.ts"),
  ]);

  assert.match(ui, /조직 · 직급 · 개인 권한/, "범위 권한 관리 화면이 없습니다.");
  assert.match(ui, /action: "scoped_permission"/, "범위 권한 저장 동작이 없습니다.");
  assert.match(route, /case "scoped_permission"/, "범위 권한 API가 없습니다.");
  assert.match(governance, /scoped_permission_policies/, "범위 권한 정책 저장소가 없습니다.");
  assert.match(governance, /\["corporation", "department", "job_title"\]/, "조직·직급 적용 우선순위가 없습니다.");
  assert.match(identity, /job_title/, "사용자 직급 필드가 없습니다.");
});
