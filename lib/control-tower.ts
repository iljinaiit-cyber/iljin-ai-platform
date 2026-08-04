import { getD1 } from "../db";
import { requirePermission } from "./admin-governance";
import { AuthError, type Principal } from "./identity";

export type ControlStatus = "implemented" | "in_progress" | "gap" | "accepted_risk";
export type SloMetricKey =
  | "agent_success_rate"
  | "retrieval_p95_ms"
  | "failed_index_jobs"
  | "expired_approvals";

type ControlDefinition = {
  id: string;
  framework: string;
  category: "거버넌스" | "보안" | "품질" | "운영";
  title: string;
  description: string;
  critical: boolean;
  defaultStatus: ControlStatus;
  baselineEvidence: string;
  referenceUrl: string;
};

export const CONTROL_CATALOG: ControlDefinition[] = [
  {
    id: "GOV-01",
    framework: "NIST AI RMF · GOVERN/MAP",
    category: "거버넌스",
    title: "AI 자산·위험 인벤토리",
    description: "Agent, 모델, 지식자산, 도구의 소유자와 위험등급 및 변경 이력을 관리합니다.",
    critical: true,
    defaultStatus: "in_progress",
    baselineEvidence: "문서 Asset과 Tool Registry는 등록되며 통합 AI 자산 카탈로그는 확장 중입니다.",
    referenceUrl: "https://airc.nist.gov/",
  },
  {
    id: "GOV-02",
    framework: "NIST AI RMF · GOVERN",
    category: "거버넌스",
    title: "책임자·증적·승인 관리",
    description: "통제별 책임자, 이행 증적, 목표일을 지정하고 변경을 감사로그로 남깁니다.",
    critical: true,
    defaultStatus: "implemented",
    baselineEvidence: "Control Tower에서 통제별 책임자·증적·목표일과 변경 감사를 관리합니다.",
    referenceUrl: "https://airc.nist.gov/AI_RMF_Knowledge_Base/Playbook",
  },
  {
    id: "GOV-03",
    framework: "Enterprise Agent Platform",
    category: "거버넌스",
    title: "Human-in-the-loop",
    description: "고위험 Tool 실행은 승인자 판단 후에만 진행하고 승인 만료를 감시합니다.",
    critical: true,
    defaultStatus: "implemented",
    baselineEvidence: "R2/R3 Tool 승인 요청·결정·만료 시각과 실행 감사가 구현되어 있습니다.",
    referenceUrl: "https://learn.microsoft.com/en-us/azure/foundry/concepts/observability",
  },
  {
    id: "SEC-01",
    framework: "OWASP LLM/Agentic",
    category: "보안",
    title: "최소권한·도구 정책",
    description: "역할과 사용자별 권한, 기능 토글, Tool 위험등급으로 실행 권한을 분리합니다.",
    critical: true,
    defaultStatus: "implemented",
    baselineEvidence: "RBAC, 사용자별 예외, 핵심 관리자 권한 보호, Tool 승인 정책, 그리고 Tool 호출 인자를 실행 직전 input_schema 기준으로 검증하는 Tool Invocation Guard가 적용되어 있습니다.",
    referenceUrl: "https://genai.owasp.org/",
  },
  {
    id: "SEC-02",
    framework: "AWS Bedrock Guardrails",
    category: "보안",
    title: "입력·출력 이중 가드레일",
    description: "모델 호출 전 입력과 응답 후 출력을 각각 검사하고 민감정보를 차단합니다.",
    critical: true,
    defaultStatus: "in_progress",
    baselineEvidence: "입력 Prompt Injection 정규식 차단(inspectUserInput), 검색 근거 신뢰등급 태깅(isLikelyInjectedContent), 출력 PII 정규식 마스킹(maskPii: 주민번호·이메일·전화번호·카드번호)이 구현되어 있습니다. Tool 호출 인자는 별도로 SEC-01의 Tool Invocation Guard가 검증합니다. 의미론적(LLM 기반) 인젝션 탐지와 전체 PII 개체 커버리지는 확장 대상입니다.",
    referenceUrl: "https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-how.html",
  },
  {
    id: "SEC-03",
    framework: "OWASP LLM/Agentic",
    category: "보안",
    title: "RAG 데이터 경계 보호",
    description: "Tenant·부서·등급 ACL을 검색 전에 적용하고 인용 가능한 근거만 노출합니다.",
    critical: true,
    defaultStatus: "in_progress",
    baselineEvidence: "Tenant·부서·문서등급 필터를 검색 쿼리 시점(사전 필터)과 Citation 구성 직전(사후 재검증) 2단계로 적용합니다. 자동 침투시험 범위는 확장 중입니다.",
    referenceUrl: "https://genai.owasp.org/llm-top-10/",
  },
  {
    id: "QLT-01",
    framework: "Microsoft Foundry Evaluation",
    category: "품질",
    title: "배포 전 회귀평가",
    description: "Golden set으로 관련성, 근거성, 안전성, Tool 정확도를 릴리스 전에 평가합니다.",
    critical: true,
    defaultStatus: "implemented",
    baselineEvidence: "Golden RAG, 보안 음성 코퍼스, G1/G2 품질 게이트 스크립트가 구성되어 있습니다.",
    referenceUrl: "https://learn.microsoft.com/en-us/azure/foundry/concepts/observability",
  },
  {
    id: "QLT-02",
    framework: "Google Vertex AI Evaluation",
    category: "품질",
    title: "운영 중 지속평가",
    description: "운영 샘플을 정기 평가해 품질·안전 드리프트와 실패 군집을 탐지합니다.",
    critical: false,
    defaultStatus: "gap",
    baselineEvidence: "오프라인 평가 기반은 있으나 운영 트래픽 표본 평가 스케줄러는 후속 구축 대상입니다.",
    referenceUrl: "https://cloud.google.com/vertex-ai/generative-ai/docs/reasoning-engine/overview",
  },
  {
    id: "QLT-03",
    framework: "RAG Quality",
    category: "품질",
    title: "근거성·인용 추적",
    description: "검색 결과, 인용, 사용자 피드백을 응답과 연결해 답변 품질을 추적합니다.",
    critical: false,
    defaultStatus: "in_progress",
    baselineEvidence: "인용 API와 메시지 피드백은 구현되었으며 자동 groundedness 평가는 확장 중입니다.",
    referenceUrl: "https://learn.microsoft.com/en-us/azure/foundry/concepts/observability",
  },
  {
    id: "OPS-01",
    framework: "OpenTelemetry GenAI",
    category: "운영",
    title: "End-to-end 추적",
    description: "Agent run, 모델, 검색, Tool 실행을 trace ID로 연결해 장애 원인을 추적합니다.",
    critical: true,
    defaultStatus: "implemented",
    baselineEvidence: "주요 API·Agent·검색·감사 이벤트에 trace ID가 전달·저장됩니다.",
    referenceUrl: "https://opentelemetry.io/docs/specs/semconv/gen-ai/",
  },
  {
    id: "OPS-02",
    framework: "Enterprise SRE",
    category: "운영",
    title: "SLO·릴리스 게이트",
    description: "성공률, 지연, 실패 Job, 승인 만료를 목표와 비교해 운영 전환 여부를 판정합니다.",
    critical: true,
    defaultStatus: "implemented",
    baselineEvidence: "Control Tower SLO 엔진과 릴리스 게이트가 현재 운영 데이터로 자동 판정합니다.",
    referenceUrl: "https://sre.google/sre-book/service-level-objectives/",
  },
  {
    id: "OPS-03",
    framework: "NIST AI RMF · MANAGE",
    category: "운영",
    title: "Incident·DR Runbook",
    description: "AI 품질·보안 사고의 중지, 우회, 복구, 회고 절차와 정기 DR 훈련을 운영합니다.",
    critical: false,
    defaultStatus: "in_progress",
    baselineEvidence: "DR 체크리스트와 검증 스크립트는 있으며 정기 훈련 증적 자동화는 후속 대상입니다.",
    referenceUrl: "https://airc.nist.gov/AI_RMF_Knowledge_Base/Playbook",
  },
];

const SLO_CATALOG: Array<{
  key: SloMetricKey;
  label: string;
  unit: string;
  comparator: "gte" | "lte";
  defaultTarget: number;
  description: string;
}> = [
  { key: "agent_success_rate", label: "Agent 성공률", unit: "%", comparator: "gte", defaultTarget: 95, description: "최근 24시간 완료·실패 Run 기준" },
  { key: "retrieval_p95_ms", label: "검색 p95 지연", unit: "ms", comparator: "lte", defaultTarget: 3000, description: "최근 24시간 Retrieval Trace 기준" },
  { key: "failed_index_jobs", label: "실패 Index Job", unit: "건", comparator: "lte", defaultTarget: 0, description: "현재 실패 상태인 색인 작업" },
  { key: "expired_approvals", label: "만료 승인 요청", unit: "건", comparator: "lte", defaultTarget: 0, description: "결정되지 않고 만료된 Tool 승인" },
];

let schemaPromise: Promise<void> | undefined;

export function ensureControlTowerSchema() {
  if (!schemaPromise) {
    const db = getD1();
    schemaPromise = db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS ai_control_assessments (
        tenant_id TEXT NOT NULL, control_id TEXT NOT NULL, status TEXT NOT NULL,
        owner_email TEXT, evidence_note TEXT NOT NULL DEFAULT '', due_date TEXT,
        updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, control_id)
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS ai_slo_policies (
        tenant_id TEXT NOT NULL, metric_key TEXT NOT NULL, target_value REAL NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, metric_key)
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS ai_control_assessments_status_idx ON ai_control_assessments(tenant_id, status)"),
    ]).then(() => undefined).catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function getActualMetrics(tenantId: string) {
  const db = getD1();
  const [agentRows, traceRows, failedJobs, expiredApprovals] = await Promise.all([
    db.prepare(`SELECT status, COUNT(*) AS count FROM agent_runs
      WHERE tenant_id = ? AND created_at >= datetime('now', '-24 hours')
      AND status IN ('completed', 'failed') GROUP BY status`).bind(tenantId).all<{ status: string; count: number }>(),
    db.prepare(`SELECT latency_ms FROM retrieval_traces
      WHERE tenant_id = ? AND created_at >= datetime('now', '-24 hours')
      ORDER BY created_at DESC LIMIT 1000`).bind(tenantId).all<{ latency_ms: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM index_jobs j JOIN assets a ON a.id = j.asset_id
      WHERE a.tenant_id = ? AND j.status = 'failed'`).bind(tenantId).first<{ count: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM tool_approval_requests r
      JOIN agent_runs a ON a.id = r.run_id
      WHERE a.tenant_id = ? AND r.status = 'pending' AND r.expires_at < ?`).bind(
        tenantId,
        new Date().toISOString(),
      ).first<{ count: number }>(),
  ]);
  const runCounts = new Map((agentRows.results || []).map((row) => [row.status, Number(row.count)]));
  const completed = runCounts.get("completed") || 0;
  const failed = runCounts.get("failed") || 0;
  const total = completed + failed;
  const p95 = percentile((traceRows.results || []).map((row) => Number(row.latency_ms)), 0.95);
  return {
    agent_success_rate: total ? Number(((completed / total) * 100).toFixed(1)) : null,
    retrieval_p95_ms: p95,
    failed_index_jobs: Number(failedJobs?.count || 0),
    expired_approvals: Number(expiredApprovals?.count || 0),
  } satisfies Record<SloMetricKey, number | null>;
}

type AssessmentRow = {
  control_id: string;
  status: ControlStatus;
  owner_email: string | null;
  evidence_note: string;
  due_date: string | null;
  updated_by: string;
  updated_at: string;
};

type SloRow = {
  metric_key: string;
  target_value: number;
  enabled: number;
  updated_by: string;
  updated_at: string;
};

async function writeAudit(principal: Principal, traceId: string, action: string, resourceId: string, details: Record<string, unknown>) {
  const now = new Date().toISOString();
  await getD1().prepare(`INSERT INTO audit_logs
    (id, tenant_id, actor_email, action, resource_type, resource_id, trace_id, outcome, details_json, created_at)
    VALUES (?, ?, ?, ?, 'ai_control', ?, ?, 'success', ?, ?)`).bind(
      `aud_${crypto.randomUUID().replaceAll("-", "")}`,
      principal.tenantId,
      principal.email,
      action,
      resourceId,
      traceId,
      JSON.stringify(details),
      now,
    ).run();
}

export async function getControlTower(principal: Principal) {
  await requirePermission(principal, "admin.operations");
  await ensureControlTowerSchema();
  const db = getD1();
  const [assessmentRows, sloRows, actuals] = await Promise.all([
    db.prepare(`SELECT control_id, status, owner_email, evidence_note, due_date, updated_by, updated_at
      FROM ai_control_assessments WHERE tenant_id = ?`).bind(principal.tenantId).all<AssessmentRow>(),
    db.prepare(`SELECT metric_key, target_value, enabled, updated_by, updated_at
      FROM ai_slo_policies WHERE tenant_id = ?`).bind(principal.tenantId).all<SloRow>(),
    getActualMetrics(principal.tenantId),
  ]);
  const assessments = new Map((assessmentRows.results || []).map((row) => [row.control_id, row]));
  const controls = CONTROL_CATALOG.map((definition) => {
    const row = assessments.get(definition.id);
    return {
      ...definition,
      status: row?.status || definition.defaultStatus,
      ownerEmail: row?.owner_email || "",
      evidenceNote: row?.evidence_note || definition.baselineEvidence,
      dueDate: row?.due_date || "",
      updatedBy: row?.updated_by,
      updatedAt: row?.updated_at,
    };
  });
  const savedSlos = new Map((sloRows.results || []).map((row) => [row.metric_key, row]));
  const slos = SLO_CATALOG.map((definition) => {
    const saved = savedSlos.get(definition.key);
    const target = saved ? Number(saved.target_value) : definition.defaultTarget;
    const actual = actuals[definition.key];
    const enabled = saved ? Boolean(saved.enabled) : true;
    const state = !enabled ? "disabled" : actual === null ? "no_data"
      : definition.comparator === "gte" ? (actual >= target ? "pass" : "fail")
        : (actual <= target ? "pass" : "fail");
    return { ...definition, target, actual, enabled, state, updatedBy: saved?.updated_by, updatedAt: saved?.updated_at };
  });
  const criticalGap = controls.some((control) => control.critical && control.status === "gap");
  const criticalProgress = controls.some((control) => control.critical && control.status === "in_progress");
  const failedSlo = slos.some((slo) => slo.state === "fail");
  const gateStatus = criticalGap ? "blocked" : criticalProgress || failedSlo ? "conditional" : "ready";
  return {
    gate: {
      status: gateStatus,
      reason: criticalGap
        ? "필수 통제의 미구현 항목을 해소해야 합니다."
        : failedSlo
          ? "SLO 이탈 항목의 원인과 완화조치를 검토해야 합니다."
          : criticalProgress
            ? "진행 중인 필수 통제의 증적 확인 후 전환할 수 있습니다."
            : "필수 통제와 수집 가능한 SLO가 기준을 충족합니다.",
    },
    summary: {
      implemented: controls.filter((control) => control.status === "implemented").length,
      inProgress: controls.filter((control) => control.status === "in_progress").length,
      gaps: controls.filter((control) => control.status === "gap").length,
      acceptedRisk: controls.filter((control) => control.status === "accepted_risk").length,
    },
    controls,
    slos,
    checkedAt: new Date().toISOString(),
  };
}

export async function updateControlAssessment(input: {
  principal: Principal;
  controlId: string;
  status: ControlStatus;
  ownerEmail?: string;
  evidenceNote?: string;
  dueDate?: string;
  traceId: string;
}) {
  await requirePermission(input.principal, "admin.settings");
  await ensureControlTowerSchema();
  if (!CONTROL_CATALOG.some((control) => control.id === input.controlId)) {
    throw new AuthError("알 수 없는 통제 항목입니다.", 400, "AUTH_INVALID_INPUT");
  }
  if (!["implemented", "in_progress", "gap", "accepted_risk"].includes(input.status)) {
    throw new AuthError("통제 상태를 확인해 주세요.", 400, "AUTH_INVALID_INPUT");
  }
  const now = new Date().toISOString();
  const ownerEmail = (input.ownerEmail || "").trim().toLowerCase().slice(0, 254);
  const evidenceNote = (input.evidenceNote || "").trim().slice(0, 2000);
  const dueDate = (input.dueDate || "").trim().slice(0, 10);
  await getD1().prepare(`INSERT INTO ai_control_assessments
    (tenant_id, control_id, status, owner_email, evidence_note, due_date, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, control_id) DO UPDATE SET status = excluded.status,
      owner_email = excluded.owner_email, evidence_note = excluded.evidence_note,
      due_date = excluded.due_date, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).bind(
        input.principal.tenantId,
        input.controlId,
        input.status,
        ownerEmail || null,
        evidenceNote,
        dueDate || null,
        input.principal.email,
        now,
      ).run();
  await writeAudit(input.principal, input.traceId, "control.assessment.updated", input.controlId, {
    status: input.status,
    ownerEmail,
    dueDate,
  });
}

export async function updateSloPolicy(input: {
  principal: Principal;
  metricKey: string;
  target: number;
  enabled: boolean;
  traceId: string;
}) {
  await requirePermission(input.principal, "admin.settings");
  await ensureControlTowerSchema();
  const definition = SLO_CATALOG.find((slo) => slo.key === input.metricKey);
  if (!definition || !Number.isFinite(input.target) || input.target < 0 || input.target > 1_000_000) {
    throw new AuthError("SLO 목표값을 확인해 주세요.", 400, "AUTH_INVALID_INPUT");
  }
  const now = new Date().toISOString();
  await getD1().prepare(`INSERT INTO ai_slo_policies
    (tenant_id, metric_key, target_value, enabled, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, metric_key) DO UPDATE SET target_value = excluded.target_value,
      enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).bind(
        input.principal.tenantId,
        definition.key,
        input.target,
        input.enabled ? 1 : 0,
        input.principal.email,
        now,
      ).run();
  await writeAudit(input.principal, input.traceId, "control.slo.updated", definition.key, {
    target: input.target,
    enabled: input.enabled,
  });
}
