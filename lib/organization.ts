import { getD1 } from "../db";
import { AuthError, type Principal } from "./identity";

/**
 * 법인·부서 조직 마스터 (2026-08-06)
 *
 * 그전까지 user_profiles.department 는 가입자가 직접 타이핑하는 자유 텍스트였다.
 * "AX전략팀"과 "AX 전략팀"이 다른 부서가 되고, 법인 개념은 아예 없었다. 그 상태로는
 * 조직 단위 권한·예산·통계를 만들 수 없다 — 집계 키가 오타로 갈라지기 때문이다.
 *
 * 여기서 조직을 1급 엔티티로 올린다. department 컬럼은 표시용으로 남기되,
 * 판정은 전부 dept_id / corp_id 로 한다.
 */

export type OrgStatus = "active" | "archived";

export interface Corporation {
  id: string;
  name: string;
  code: string | null;
  status: OrgStatus;
  departmentCount: number;
  memberCount: number;
}

export interface Department {
  id: string;
  corpId: string;
  parentId: string | null;
  name: string;
  code: string | null;
  status: OrgStatus;
  memberCount: number;
  /** 루트에서의 깊이. 0 = 법인 직속. UI 들여쓰기용. */
  depth: number;
  path: string;
}

let orgSchemaPromise: Promise<void> | undefined;

export function ensureOrganizationSchema() {
  if (!orgSchemaPromise) {
    orgSchemaPromise = (async () => {
      const db = getD1();
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS corporations (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
          code TEXT, status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS departments (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, corp_id TEXT NOT NULL,
          parent_id TEXT, name TEXT NOT NULL, code TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          FOREIGN KEY (corp_id) REFERENCES corporations(id) ON DELETE CASCADE
        )`),
        db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS corporations_name_idx ON corporations(tenant_id, name)"),
        db.prepare("CREATE INDEX IF NOT EXISTS departments_corp_idx ON departments(tenant_id, corp_id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS departments_parent_idx ON departments(parent_id)"),
        db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS departments_name_idx
          ON departments(tenant_id, corp_id, COALESCE(parent_id, ''), name)`),
      ]);
      // user_profiles 는 이미 운영 중이라 ALTER 로 붙인다. 기존 행은 NULL 로 남고
      // 관리자가 배정하기 전까지 "미배정"으로 취급된다 — 임의 추측 배정은 하지 않는다.
      const columns = await db.prepare("PRAGMA table_info(user_profiles)").all<{ name: string }>();
      const existing = new Set((columns.results ?? []).map((c) => c.name));
      if (!existing.has("corp_id")) {
        await db.prepare("ALTER TABLE user_profiles ADD COLUMN corp_id TEXT").run();
      }
      if (!existing.has("dept_id")) {
        await db.prepare("ALTER TABLE user_profiles ADD COLUMN dept_id TEXT").run();
      }
      await db.prepare(
        "CREATE INDEX IF NOT EXISTS user_profiles_org_idx ON user_profiles(tenant_id, corp_id, dept_id)",
      ).run();
    })().catch((error) => {
      orgSchemaPromise = undefined;
      throw error;
    });
  }
  return orgSchemaPromise;
}

function slugify(value: string) {
  const base = value.trim().toLowerCase()
    .replace(/[^\w가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // 한글 부서명은 slug 로 남겨도 무방하지만, 빈 문자열이 되면 ID 로 못 쓴다.
  return base || `org-${crypto.randomUUID().slice(0, 8)}`;
}

function assertName(value: string, label: string) {
  const name = value.trim();
  if (!name || name.length > 120) {
    throw new AuthError(`${label} 이름을 1~120자로 입력해 주세요.`, 400, "AUTH_INVALID_INPUT");
  }
  return name;
}

// ── 조회 ────────────────────────────────────────────────────────────────

export async function listCorporations(tenantId: string): Promise<Corporation[]> {
  await ensureOrganizationSchema();
  const rows = await getD1().prepare(`
    SELECT c.id, c.name, c.code, c.status,
      (SELECT COUNT(*) FROM departments d WHERE d.corp_id = c.id AND d.status = 'active') AS department_count,
      (SELECT COUNT(*) FROM user_profiles u WHERE u.corp_id = c.id) AS member_count
    FROM corporations c
    WHERE c.tenant_id = ?
    ORDER BY c.status = 'archived', c.name
  `).bind(tenantId).all<{
    id: string; name: string; code: string | null; status: string;
    department_count: number; member_count: number;
  }>();
  return (rows.results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    status: r.status === "archived" ? "archived" : "active",
    departmentCount: Number(r.department_count || 0),
    memberCount: Number(r.member_count || 0),
  }));
}

/**
 * 부서 트리를 평탄화해 돌려준다. 재귀 CTE 로 깊이와 경로를 함께 계산하므로
 * 애플리케이션에서 트리를 다시 조립할 필요가 없다.
 */
export async function listDepartments(tenantId: string, corpId?: string): Promise<Department[]> {
  await ensureOrganizationSchema();
  const rows = await getD1().prepare(`
    WITH RECURSIVE tree AS (
      SELECT d.id, d.corp_id, d.parent_id, d.name, d.code, d.status,
             0 AS depth, d.name AS path
      FROM departments d
      WHERE d.tenant_id = ?1 AND d.parent_id IS NULL
        AND (?2 IS NULL OR d.corp_id = ?2)
      UNION ALL
      SELECT d.id, d.corp_id, d.parent_id, d.name, d.code, d.status,
             tree.depth + 1, tree.path || ' > ' || d.name
      FROM departments d
      JOIN tree ON d.parent_id = tree.id
      WHERE d.tenant_id = ?1
    )
    SELECT tree.*,
      (SELECT COUNT(*) FROM user_profiles u WHERE u.dept_id = tree.id) AS member_count
    FROM tree
    ORDER BY tree.path
  `).bind(tenantId, corpId ?? null).all<{
    id: string; corp_id: string; parent_id: string | null; name: string;
    code: string | null; status: string; depth: number; path: string; member_count: number;
  }>();
  return (rows.results ?? []).map((r) => ({
    id: r.id,
    corpId: r.corp_id,
    parentId: r.parent_id,
    name: r.name,
    code: r.code,
    status: r.status === "archived" ? "archived" : "active",
    depth: Number(r.depth || 0),
    path: r.path,
    memberCount: Number(r.member_count || 0),
  }));
}

/**
 * 특정 부서와 그 하위 부서 ID 전부. 조직 단위 권한·예산·통계의 기본 단위다.
 * "본부장은 본부 전체를 본다"가 이 함수 하나로 성립한다.
 */
export async function departmentSubtreeIds(tenantId: string, deptId: string): Promise<string[]> {
  await ensureOrganizationSchema();
  const rows = await getD1().prepare(`
    WITH RECURSIVE sub AS (
      SELECT id FROM departments WHERE tenant_id = ?1 AND id = ?2
      UNION ALL
      SELECT d.id FROM departments d JOIN sub ON d.parent_id = sub.id WHERE d.tenant_id = ?1
    )
    SELECT id FROM sub
  `).bind(tenantId, deptId).all<{ id: string }>();
  return (rows.results ?? []).map((r) => r.id);
}

// ── 변경 ────────────────────────────────────────────────────────────────

export async function createCorporation(input: {
  principal: Principal; name: string; code?: string;
}): Promise<Corporation> {
  await ensureOrganizationSchema();
  const name = assertName(input.name, "법인");
  const id = slugify(name);
  const now = new Date().toISOString();
  try {
    await getD1().prepare(`INSERT INTO corporations (id, tenant_id, name, code, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)`)
      .bind(id, input.principal.tenantId, name, input.code?.trim() || null, now, now).run();
  } catch {
    throw new AuthError("이미 같은 이름의 법인이 있습니다.", 409, "AUTH_ACCOUNT_EXISTS");
  }
  return { id, name, code: input.code?.trim() || null, status: "active", departmentCount: 0, memberCount: 0 };
}

export async function createDepartment(input: {
  principal: Principal; corpId: string; name: string; parentId?: string; code?: string;
}): Promise<Department> {
  await ensureOrganizationSchema();
  const db = getD1();
  const name = assertName(input.name, "부서");
  const corp = await db.prepare("SELECT id FROM corporations WHERE id = ? AND tenant_id = ?")
    .bind(input.corpId, input.principal.tenantId).first();
  if (!corp) throw new AuthError("법인을 찾을 수 없습니다.", 400, "AUTH_INVALID_INPUT");

  if (input.parentId) {
    // 상위 부서는 같은 법인 안에 있어야 한다. 법인을 가로지르는 트리는 조직도가 아니다.
    const parent = await db.prepare("SELECT corp_id FROM departments WHERE id = ? AND tenant_id = ?")
      .bind(input.parentId, input.principal.tenantId).first<{ corp_id: string }>();
    if (!parent) throw new AuthError("상위 부서를 찾을 수 없습니다.", 400, "AUTH_INVALID_INPUT");
    if (parent.corp_id !== input.corpId) {
      throw new AuthError("상위 부서가 다른 법인에 속해 있습니다.", 400, "AUTH_INVALID_INPUT");
    }
  }

  const id = `${input.corpId}--${slugify(name)}`;
  const now = new Date().toISOString();
  try {
    await db.prepare(`INSERT INTO departments
      (id, tenant_id, corp_id, parent_id, name, code, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
      .bind(id, input.principal.tenantId, input.corpId, input.parentId || null,
            name, input.code?.trim() || null, now, now).run();
  } catch {
    throw new AuthError("같은 상위 조직에 동일한 이름의 부서가 있습니다.", 409, "AUTH_ACCOUNT_EXISTS");
  }
  return {
    id, corpId: input.corpId, parentId: input.parentId || null, name,
    code: input.code?.trim() || null, status: "active", memberCount: 0, depth: 0, path: name,
  };
}

/**
 * 조직은 삭제하지 않고 보관 처리한다. 이미 발생한 감사 로그·대화·문서가 부서 ID를
 * 참조하고 있어서, 삭제하면 과거 기록의 소속이 사라진다.
 */
export async function archiveDepartment(input: { principal: Principal; deptId: string }) {
  await ensureOrganizationSchema();
  const ids = await departmentSubtreeIds(input.principal.tenantId, input.deptId);
  if (!ids.length) throw new AuthError("부서를 찾을 수 없습니다.", 400, "AUTH_INVALID_INPUT");
  const placeholders = ids.map(() => "?").join(",");
  await getD1().prepare(
    `UPDATE departments SET status = 'archived', updated_at = ? WHERE id IN (${placeholders})`,
  ).bind(new Date().toISOString(), ...ids).run();
  return { archived: ids.length };
}

export async function assignUserOrganization(input: {
  principal: Principal; email: string; corpId: string | null; deptId: string | null;
}) {
  await ensureOrganizationSchema();
  const db = getD1();
  const tenantId = input.principal.tenantId;

  let displayDepartment = "미지정";
  if (input.deptId) {
    const dept = await db.prepare("SELECT corp_id, name FROM departments WHERE id = ? AND tenant_id = ?")
      .bind(input.deptId, tenantId).first<{ corp_id: string; name: string }>();
    if (!dept) throw new AuthError("부서를 찾을 수 없습니다.", 400, "AUTH_INVALID_INPUT");
    // 부서가 정해지면 법인은 부서로부터 확정한다. 둘을 따로 받으면 어긋날 수 있다.
    if (input.corpId && input.corpId !== dept.corp_id) {
      throw new AuthError("선택한 부서가 해당 법인 소속이 아닙니다.", 400, "AUTH_INVALID_INPUT");
    }
    input.corpId = dept.corp_id;
    displayDepartment = dept.name;
  } else if (input.corpId) {
    const corp = await db.prepare("SELECT name FROM corporations WHERE id = ? AND tenant_id = ?")
      .bind(input.corpId, tenantId).first<{ name: string }>();
    if (!corp) throw new AuthError("법인을 찾을 수 없습니다.", 400, "AUTH_INVALID_INPUT");
  }

  const result = await db.prepare(`UPDATE user_profiles
    SET corp_id = ?, dept_id = ?, department = ?, updated_at = ?
    WHERE email = ? AND tenant_id = ?`)
    .bind(input.corpId, input.deptId, displayDepartment,
          new Date().toISOString(), input.email.toLowerCase(), tenantId).run();
  if (!result.meta.changes) {
    throw new AuthError("사용자를 찾을 수 없습니다.", 400, "AUTH_INVALID_INPUT");
  }
  return { email: input.email.toLowerCase(), corpId: input.corpId, deptId: input.deptId };
}
