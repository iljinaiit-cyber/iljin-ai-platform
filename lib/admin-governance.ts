import { getD1 } from "../db";
import { AuthError, type Principal, type UserRole } from "./identity";

export type PermissionKey =
  | "workspace.home"
  | "ai.chat"
  | "rag.search"
  | "documents.read"
  | "documents.manage"
  | "agent.run"
  | "tools.review"
  | "activity.read"
  | "admin.operations"
  | "admin.users"
  | "admin.permissions"
  | "admin.settings"
  | "admin.audit";

export type FeatureKey =
  | "workspace.home"
  | "ai.chat"
  | "ai.chat.image-gen"
  | "ai.chat.tts"
  | "rag.search"
  | "documents"
  | "documents.upload"
  | "agent"
  | "tool.approvals"
  | "activity"
  | "llm.local_primary"
  | "llm.cloudflare_secondary";

export const PERMISSION_CATALOG: Array<{
  key: PermissionKey;
  category: string;
  label: string;
  description: string;
  coreAdmin?: boolean;
}> = [
  { key: "workspace.home", category: "사용자 Portal", label: "홈", description: "개인·부서 업무 홈과 활용 예시 조회" },
  { key: "ai.chat", category: "사용자 Portal", label: "AI Chat Agent", description: "AI Chat Agent와 대화 이력 생성" },
  { key: "rag.search", category: "사용자 Portal", label: "ILJIN Knowledge Base", description: "사내 지식 카탈로그, RAG 검색, 최신 버전과 인용 근거 조회" },
  { key: "documents.read", category: "문서/RAG", label: "문서 조회", description: "접근 가능한 문서와 인덱스 조회" },
  { key: "documents.manage", category: "문서/RAG", label: "문서 관리", description: "문서 등록·수정·삭제·재색인" },
  { key: "agent.run", category: "Agent", label: "Agent 실행", description: "Agent 작업 생성과 실행 이력 조회" },
  { key: "tools.review", category: "Agent", label: "Tool 승인", description: "위험 Tool 실행 승인·거절" },
  { key: "activity.read", category: "사용자 Portal", label: "내 활동", description: "본인의 대화·검색·Agent 활동 조회" },
  { key: "admin.operations", category: "관리자", label: "운영 현황", description: "RAG·Provider·인덱싱 운영 정보 조회" },
  { key: "admin.users", category: "관리자", label: "사용자 관리", description: "가입 승인·역할·상태·부서 관리", coreAdmin: true },
  { key: "admin.permissions", category: "관리자", label: "권한 정책", description: "역할 및 개인별 권한 설정", coreAdmin: true },
  { key: "admin.settings", category: "관리자", label: "기능 설정", description: "Tenant 기능 활성화와 사용 중지 설정", coreAdmin: true },
  { key: "admin.audit", category: "관리자", label: "감사 이력", description: "관리자 변경 이력 조회", coreAdmin: true },
];

export const FEATURE_CATALOG: Array<{
  key: FeatureKey;
  category: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
}> = [
  { key: "workspace.home", category: "Portal", label: "업무 홈", description: "개인·부서별 업무 홈을 제공합니다.", defaultEnabled: true },
  { key: "ai.chat", category: "AI", label: "AI Chat Agent", description: "AI Chat Agent 기능을 전체 사용자에게 제공합니다.", defaultEnabled: true },
  { key: "rag.search", category: "RAG", label: "ILJIN Knowledge Base", description: "권한 기반 지식 탐색, 최신 문서 검색과 근거 인용 기능을 제공합니다.", defaultEnabled: true },
  { key: "documents", category: "RAG", label: "문서 조회", description: "문서 자산과 인덱스 조회를 허용합니다.", defaultEnabled: true },
  { key: "documents.upload", category: "RAG", label: "문서 등록", description: "문서 업로드와 재색인을 허용합니다.", defaultEnabled: true },
  { key: "agent", category: "Agent", label: "Agent 실행", description: "업무 Agent 실행 기능을 제공합니다.", defaultEnabled: true },
  { key: "tool.approvals", category: "Agent", label: "Tool 승인", description: "고위험 Tool 승인 워크플로를 사용합니다.", defaultEnabled: true },
  { key: "activity", category: "Portal", label: "활동 이력", description: "사용자 활동 조회 화면을 제공합니다.", defaultEnabled: true },
  { key: "llm.local_primary", category: "LLM", label: "로컬 LLM 폴백", description: "Cloudflare 장애 시 로컬 vLLM을 폴백 Provider로 사용합니다.", defaultEnabled: true },
  { key: "llm.cloudflare_secondary", category: "LLM", label: "Cloudflare GLM 5.2 기본", description: "public/internal 요청의 기본 Provider로 Cloudflare GLM 5.2를 사용합니다.", defaultEnabled: true },
];

const ROLE_DEFAULTS: Record<UserRole, Set<PermissionKey>> = {
  user: new Set([
    "workspace.home",
    "ai.chat",
    "rag.search",
    "documents.read",
    "agent.run",
    "activity.read",
  ]),
  manager: new Set([
    "workspace.home",
    "ai.chat",
    "rag.search",
    "documents.read",
    "documents.manage",
    "agent.run",
    "tools.review",
    "activity.read",
  ]),
  admin: new Set(PERMISSION_CATALOG.map((permission) => permission.key)),
};

const CORE_ADMIN_KEYS = new Set(
  PERMISSION_CATALOG.filter((permission) => permission.coreAdmin).map((permission) => permission.key),
);

let governanceSchemaPromise: Promise<void> | undefined;

export function ensureGovernanceSchema() {
  if (!governanceSchemaPromise) {
    governanceSchemaPromise = (async () => {
      const db = getD1();
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS role_permissions (
          tenant_id TEXT NOT NULL, role TEXT NOT NULL, permission_key TEXT NOT NULL,
          allowed INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, role, permission_key)
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS user_permission_overrides (
          tenant_id TEXT NOT NULL, email TEXT NOT NULL, permission_key TEXT NOT NULL,
          allowed INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, email, permission_key),
          FOREIGN KEY (email) REFERENCES user_profiles(email) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS feature_settings (
          tenant_id TEXT NOT NULL, feature_key TEXT NOT NULL, enabled INTEGER NOT NULL,
          config_json TEXT NOT NULL DEFAULT '{}', updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, feature_key)
        )`),
        db.prepare("CREATE INDEX IF NOT EXISTS user_permission_overrides_email_idx ON user_permission_overrides(tenant_id, email)"),
        db.prepare("CREATE INDEX IF NOT EXISTS feature_settings_tenant_idx ON feature_settings(tenant_id, feature_key)"),
      ]);
    })().catch((error) => {
      governanceSchemaPromise = undefined;
      throw error;
    });
  }
  return governanceSchemaPromise;
}

function permissionExists(value: string): value is PermissionKey {
  return PERMISSION_CATALOG.some((permission) => permission.key === value);
}

function featureExists(value: string): value is FeatureKey {
  return FEATURE_CATALOG.some((feature) => feature.key === value);
}

type PermissionRow = { permission_key: string; allowed: number };
type FeatureRow = { feature_key: string; enabled: number; config_json: string; updated_by: string; updated_at: string };
type OverrideRow = PermissionRow & { email: string };

export async function getEffectivePermissions(principal: Principal) {
  await ensureGovernanceSchema();
  const db = getD1();
  const [roleResult, overrideResult] = await Promise.all([
    db.prepare(`SELECT permission_key, allowed FROM role_permissions
      WHERE tenant_id = ? AND role = ?`).bind(principal.tenantId, principal.role).all<PermissionRow>(),
    db.prepare(`SELECT permission_key, allowed FROM user_permission_overrides
      WHERE tenant_id = ? AND email = ?`).bind(principal.tenantId, principal.email).all<PermissionRow>(),
  ]);
  const permissions = new Map<PermissionKey, boolean>(
    PERMISSION_CATALOG.map(({ key }) => [key, ROLE_DEFAULTS[principal.role].has(key)]),
  );
  for (const row of roleResult.results || []) {
    if (permissionExists(row.permission_key)) permissions.set(row.permission_key, Boolean(row.allowed));
  }
  for (const row of overrideResult.results || []) {
    if (permissionExists(row.permission_key)) permissions.set(row.permission_key, Boolean(row.allowed));
  }
  if (principal.role === "admin") {
    for (const key of CORE_ADMIN_KEYS) permissions.set(key, true);
  }
  return permissions;
}

export async function requirePermission(principal: Principal, permissionKey: PermissionKey) {
  const permissions = await getEffectivePermissions(principal);
  if (!permissions.get(permissionKey)) {
    throw new AuthError("이 기능을 사용할 권한이 없습니다. 관리자에게 문의해 주세요.", 403, "AUTH_FORBIDDEN");
  }
}

export async function getFeatureSettings(tenantId: string) {
  await ensureGovernanceSchema();
  const result = await getD1().prepare(`SELECT feature_key, enabled, config_json, updated_by, updated_at
    FROM feature_settings WHERE tenant_id = ?`).bind(tenantId).all<FeatureRow>();
  const saved = new Map((result.results || []).map((row) => [row.feature_key, row]));
  return FEATURE_CATALOG.map((feature) => {
    const row = saved.get(feature.key);
    return {
      ...feature,
      enabled: row ? Boolean(row.enabled) : feature.defaultEnabled,
      config: row ? JSON.parse(row.config_json || "{}") as Record<string, unknown> : {},
      updatedBy: row?.updated_by,
      updatedAt: row?.updated_at,
    };
  });
}

export async function requireFeature(tenantId: string, featureKey: FeatureKey) {
  const settings = await getFeatureSettings(tenantId);
  const setting = settings.find((feature) => feature.key === featureKey);
  if (!setting?.enabled) {
    throw new AuthError("관리자가 현재 이 기능을 중지했습니다.", 403, "AUTH_FORBIDDEN");
  }
}

export async function authorizeFeature(
  principal: Principal,
  permissionKey: PermissionKey,
  featureKey?: FeatureKey,
) {
  await requirePermission(principal, permissionKey);
  if (featureKey) await requireFeature(principal.tenantId, featureKey);
}

export async function writeAudit(input: {
  principal: Principal;
  action: string;
  resourceType: string;
  resourceId: string;
  traceId: string;
  details: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  await getD1().prepare(`INSERT INTO audit_logs
    (id, tenant_id, actor_email, action, resource_type, resource_id, trace_id, outcome, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'success', ?, ?)`).bind(
      `aud_${crypto.randomUUID().replaceAll("-", "")}`,
      input.principal.tenantId,
      input.principal.email,
      input.action,
      input.resourceType,
      input.resourceId,
      input.traceId,
      JSON.stringify(input.details),
      now,
    ).run();
}

export async function getGovernanceDashboard(principal: Principal) {
  await requirePermission(principal, "admin.permissions");
  await ensureGovernanceSchema();
  const db = getD1();
  const [roleResult, overrideResult, userResult, auditResult, features] = await Promise.all([
    db.prepare(`SELECT role, permission_key, allowed, updated_by, updated_at
      FROM role_permissions WHERE tenant_id = ?`).bind(principal.tenantId).all<{
        role: UserRole;
        permission_key: string;
        allowed: number;
        updated_by: string;
        updated_at: string;
      }>(),
    db.prepare(`SELECT email, permission_key, allowed FROM user_permission_overrides
      WHERE tenant_id = ?`).bind(principal.tenantId).all<OverrideRow>(),
    db.prepare(`SELECT email, display_name, department, corp_id, dept_id, role, status, approved_at, updated_at
      FROM user_profiles WHERE tenant_id = ? ORDER BY
      CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, display_name, email
      LIMIT 500`).bind(principal.tenantId).all<{
        email: string;
        display_name: string;
        department: string;
        corp_id: string | null;
        dept_id: string | null;
        role: UserRole;
        status: string;
        approved_at: string | null;
        updated_at: string;
      }>(),
    db.prepare(`SELECT id, actor_email, action, resource_type, resource_id, details_json, created_at
      FROM audit_logs WHERE tenant_id = ? AND (
        action LIKE 'governance.%' OR action LIKE 'access.%'
        OR action LIKE 'organization.%' OR action LIKE 'budget.%'
      ) ORDER BY created_at DESC LIMIT 100`).bind(principal.tenantId).all<{
        id: string;
        actor_email: string;
        action: string;
        resource_type: string;
        resource_id: string | null;
        details_json: string | null;
        created_at: string;
      }>(),
    getFeatureSettings(principal.tenantId),
  ]);
  const savedRoles = new Map(
    (roleResult.results || []).map((row) => [`${row.role}:${row.permission_key}`, Boolean(row.allowed)]),
  );
  const rolePermissions = (["user", "manager", "admin"] as UserRole[]).map((role) => ({
    role,
    permissions: Object.fromEntries(PERMISSION_CATALOG.map(({ key }) => [
      key,
      role === "admin" && CORE_ADMIN_KEYS.has(key)
        ? true
        : savedRoles.get(`${role}:${key}`) ?? ROLE_DEFAULTS[role].has(key),
    ])),
  }));
  const overridesByEmail = new Map<string, Record<string, boolean>>();
  for (const row of overrideResult.results || []) {
    overridesByEmail.set(row.email, {
      ...(overridesByEmail.get(row.email) || {}),
      [row.permission_key]: Boolean(row.allowed),
    });
  }
  return {
    permissions: PERMISSION_CATALOG,
    rolePermissions,
    users: (userResult.results || []).map((row) => ({
      email: row.email,
      displayName: row.display_name,
      department: row.department,
      role: row.role,
      status: row.status,
      approvedAt: row.approved_at,
      updatedAt: row.updated_at,
      overrides: overridesByEmail.get(row.email) || {},
    })),
    features,
    audit: (auditResult.results || []).map((row) => ({
      id: row.id,
      actorEmail: row.actor_email,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      details: row.details_json ? JSON.parse(row.details_json) as Record<string, unknown> : {},
      createdAt: row.created_at,
    })),
  };
}

export async function updateRolePermission(input: {
  principal: Principal;
  role: UserRole;
  permissionKey: string;
  allowed: boolean;
  traceId: string;
}) {
  await requirePermission(input.principal, "admin.permissions");
  if (!permissionExists(input.permissionKey)) {
    throw new AuthError("알 수 없는 권한 항목입니다.", 400, "AUTH_INVALID_INPUT");
  }
  if (input.role === "admin" && CORE_ADMIN_KEYS.has(input.permissionKey)) {
    throw new AuthError("핵심 관리자 권한은 비활성화할 수 없습니다.", 403, "AUTH_FORBIDDEN");
  }
  const now = new Date().toISOString();
  await getD1().prepare(`INSERT INTO role_permissions
    (tenant_id, role, permission_key, allowed, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, role, permission_key) DO UPDATE SET
      allowed = excluded.allowed, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).bind(
        input.principal.tenantId,
        input.role,
        input.permissionKey,
        input.allowed ? 1 : 0,
        input.principal.email,
        now,
      ).run();
  await writeAudit({
    principal: input.principal,
    action: "governance.role_permission.updated",
    resourceType: "role_permission",
    resourceId: `${input.role}:${input.permissionKey}`,
    traceId: input.traceId,
    details: { role: input.role, permissionKey: input.permissionKey, allowed: input.allowed },
  });
}

export async function updateUserPermission(input: {
  principal: Principal;
  email: string;
  permissionKey: string;
  allowed: boolean | null;
  traceId: string;
}) {
  await requirePermission(input.principal, "admin.permissions");
  if (!permissionExists(input.permissionKey)) {
    throw new AuthError("알 수 없는 권한 항목입니다.", 400, "AUTH_INVALID_INPUT");
  }
  const email = input.email.trim().toLowerCase();
  const target = await getD1().prepare("SELECT role FROM user_profiles WHERE tenant_id = ? AND email = ?")
    .bind(input.principal.tenantId, email).first<{ role: UserRole }>();
  if (!target) throw new AuthError("권한을 변경할 사용자를 찾을 수 없습니다.", 400, "AUTH_INVALID_INPUT");
  if (target.role === "admin" && CORE_ADMIN_KEYS.has(input.permissionKey) && input.allowed === false) {
    throw new AuthError("관리자의 핵심 관리 권한은 차단할 수 없습니다.", 403, "AUTH_FORBIDDEN");
  }
  const db = getD1();
  if (input.allowed === null) {
    await db.prepare(`DELETE FROM user_permission_overrides
      WHERE tenant_id = ? AND email = ? AND permission_key = ?`).bind(
        input.principal.tenantId, email, input.permissionKey,
      ).run();
  } else {
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO user_permission_overrides
      (tenant_id, email, permission_key, allowed, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, email, permission_key) DO UPDATE SET
        allowed = excluded.allowed, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).bind(
          input.principal.tenantId,
          email,
          input.permissionKey,
          input.allowed ? 1 : 0,
          input.principal.email,
          now,
        ).run();
  }
  await writeAudit({
    principal: input.principal,
    action: "governance.user_permission.updated",
    resourceType: "user_permission",
    resourceId: `${email}:${input.permissionKey}`,
    traceId: input.traceId,
    details: { email, permissionKey: input.permissionKey, allowed: input.allowed },
  });
}

export async function updateFeatureSetting(input: {
  principal: Principal;
  featureKey: string;
  enabled: boolean;
  traceId: string;
}) {
  await requirePermission(input.principal, "admin.settings");
  if (!featureExists(input.featureKey)) {
    throw new AuthError("알 수 없는 기능 설정입니다.", 400, "AUTH_INVALID_INPUT");
  }
  const now = new Date().toISOString();
  await getD1().prepare(`INSERT INTO feature_settings
    (tenant_id, feature_key, enabled, config_json, updated_by, updated_at)
    VALUES (?, ?, ?, '{}', ?, ?)
    ON CONFLICT(tenant_id, feature_key) DO UPDATE SET
      enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).bind(
        input.principal.tenantId,
        input.featureKey,
        input.enabled ? 1 : 0,
        input.principal.email,
        now,
      ).run();
  await writeAudit({
    principal: input.principal,
    action: "governance.feature.updated",
    resourceType: "feature_setting",
    resourceId: input.featureKey,
    traceId: input.traceId,
    details: { featureKey: input.featureKey, enabled: input.enabled },
  });
}

export async function updateManagedUser(input: {
  principal: Principal;
  email: string;
  role: UserRole;
  status: "approved" | "rejected";
  department: string;
  traceId: string;
}) {
  await requirePermission(input.principal, "admin.users");
  const email = input.email.trim().toLowerCase();
  if (email === input.principal.email && (input.role !== "admin" || input.status !== "approved")) {
    throw new AuthError("현재 로그인한 관리자 자신의 권한이나 승인 상태는 낮출 수 없습니다.", 403, "AUTH_FORBIDDEN");
  }
  const db = getD1();
  const target = await db.prepare("SELECT role, status FROM user_profiles WHERE tenant_id = ? AND email = ?")
    .bind(input.principal.tenantId, email).first<{ role: UserRole; status: string }>();
  if (!target) throw new AuthError("관리할 사용자를 찾을 수 없습니다.", 400, "AUTH_INVALID_INPUT");
  if (target.role === "admin" && input.role !== "admin") {
    const admins = await db.prepare(`SELECT COUNT(*) AS count FROM user_profiles
      WHERE tenant_id = ? AND role = 'admin' AND status = 'approved'`).bind(input.principal.tenantId)
      .first<{ count: number }>();
    if ((admins?.count || 0) <= 1) {
      throw new AuthError("마지막 관리자는 일반 역할로 변경할 수 없습니다.", 403, "AUTH_FORBIDDEN");
    }
  }
  const department = input.department.trim().slice(0, 120);
  if (!department) throw new AuthError("부서를 입력해 주세요.", 400, "AUTH_INVALID_INPUT");
  const now = new Date().toISOString();
  await db.prepare(`UPDATE user_profiles SET role = ?, status = ?, department = ?,
    approved_by = ?, approved_at = CASE WHEN ? = 'approved' THEN ? ELSE approved_at END,
    rejection_reason = CASE WHEN ? = 'rejected' THEN '관리자 계정 관리에서 접근이 중지되었습니다.' ELSE NULL END,
    updated_at = ? WHERE tenant_id = ? AND email = ?`).bind(
      input.role,
      input.status,
      department,
      input.principal.email,
      input.status,
      now,
      input.status,
      now,
      input.principal.tenantId,
      email,
    ).run();
  await writeAudit({
    principal: input.principal,
    action: "governance.user.updated",
    resourceType: "user_profile",
    resourceId: email,
    traceId: input.traceId,
    details: {
      email,
      before: { role: target.role, status: target.status },
      after: { role: input.role, status: input.status, department },
    },
  });
}

export async function getClientAccessControl(principal: Principal) {
  const [permissions, features] = await Promise.all([
    getEffectivePermissions(principal),
    getFeatureSettings(principal.tenantId),
  ]);
  return {
    permissions: [...permissions.entries()].filter(([, allowed]) => allowed).map(([key]) => key),
    features: Object.fromEntries(features.map((feature) => [feature.key, feature.enabled])),
  };
}
