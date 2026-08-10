import { getD1 } from "../db";
import { audit } from "./conversations";
import type { Principal, UserRole } from "./identity";
import { getRagStatus, searchRag } from "./rag";
import { createScheduleWorkItem, deleteScheduleWorkItemsForSource, syncScheduleWorkItemStatus } from "./schedule-planning";

export type RiskLevel = "R0" | "R1" | "R2" | "R3";
export type AgentState = "router" | "planner" | "retrieval" | "verification" | "execution";
export type AgentRunStatus = "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";

export class AgentError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
  }
}

type ToolRow = {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  risk_level: RiskLevel;
  mode: "read_only" | "write";
  adapter_type: "builtin" | "external";
  enabled: number;
  timeout_ms: number;
  max_retries: number;
  input_schema_json: string;
  required_roles_json: string;
  created_at: string;
  updated_at: string;
};

type RunRow = {
  id: string;
  tenant_id: string;
  owner_email: string;
  title: string;
  objective: string;
  status: AgentRunStatus;
  current_state: AgentState;
  selected_tool_id: string | null;
  max_iterations: number;
  iteration_count: number;
  idempotency_key: string;
  input_json: string | null;
  output_json: string | null;
  error_code: string | null;
  error_message: string | null;
  trace_id: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type ApprovalRow = {
  id: string;
  run_id: string;
  step_id: string;
  tool_id: string;
  requester_email: string;
  status: "pending" | "approved" | "rejected" | "expired" | "consumed";
  reason: string;
  input_json: string;
  decision_by: string | null;
  decision_note: string | null;
  decided_at: string | null;
  expires_at: string;
  created_at: string;
  objective?: string;
  run_status?: AgentRunStatus;
  tool_name?: string;
  risk_level?: RiskLevel;
  mode?: string;
};

const MAX_AGENT_ITERATIONS = 5;
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
const RISK_WEIGHT: Record<RiskLevel, number> = { R0: 0, R1: 1, R2: 2, R3: 3 };

const TOOL_SEEDS = [
  {
    id: "platform.rag_status",
    name: "RAG 플랫폼 상태 조회",
    description: "현재 사용자의 권한 범위에서 문서·세그먼트 수와 RAG 구성 상태를 읽습니다.",
    riskLevel: "R0",
    mode: "read_only",
    adapterType: "builtin",
    enabled: 1,
    timeoutMs: 2000,
    maxRetries: 0,
    inputSchema: { type: "object", additionalProperties: false },
    roles: ["user", "manager", "admin"],
  },
  {
    id: "knowledge.search",
    name: "사내 지식 근거 검색",
    description: "부서 ACL을 적용한 Hybrid Search를 실행하고 Citation 근거를 반환합니다.",
    riskLevel: "R1",
    mode: "read_only",
    adapterType: "builtin",
    enabled: 1,
    timeoutMs: 10000,
    maxRetries: 1,
    inputSchema: { type: "object", properties: { query: { type: "string", minLength: 2, maxLength: 1000 } } },
    roles: ["user", "manager", "admin"],
  },
  {
    id: "controlled.change_evidence",
    name: "통제 변경 증빙 생성",
    description: "R2 승인 경로를 검증하기 위한 읽기 전용 Demo Tool입니다. 외부 시스템을 변경하지 않고 승인·멱등성 증빙만 생성합니다.",
    riskLevel: "R2",
    mode: "read_only",
    adapterType: "builtin",
    enabled: 1,
    timeoutMs: 2000,
    maxRetries: 0,
    inputSchema: { type: "object", properties: { change: { type: "string", maxLength: 1000 } } },
    roles: ["user", "manager", "admin"],
  },
  {
    id: "erp.purchase_order.read",
    name: "ERP 구매오더 조회",
    description: "ERP Adapter 계약 예시입니다. Sandbox와 인증정보가 없어 비활성화되어 있습니다.",
    riskLevel: "R1",
    mode: "read_only",
    adapterType: "external",
    enabled: 0,
    timeoutMs: 5000,
    maxRetries: 1,
    inputSchema: { type: "object", properties: { purchaseOrderId: { type: "string" } }, required: ["purchaseOrderId"] },
    roles: ["user", "manager", "admin"],
  },
  {
    id: "itsm.ticket.create",
    name: "ITSM 티켓 생성",
    description: "ITSM Adapter 계약 예시입니다. R2 승인과 실제 연결정보가 필요하며 현재 비활성화되어 있습니다.",
    riskLevel: "R2",
    mode: "write",
    adapterType: "external",
    enabled: 0,
    timeoutMs: 5000,
    maxRetries: 0,
    inputSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
    roles: ["manager", "admin"],
  },
  {
    id: "mes.work_order.update",
    name: "MES 작업지시 변경",
    description: "MES Adapter 계약 예시입니다. R3 이중 통제와 Sandbox가 없어 비활성화되어 있습니다.",
    riskLevel: "R3",
    mode: "write",
    adapterType: "external",
    enabled: 0,
    timeoutMs: 5000,
    maxRetries: 0,
    inputSchema: { type: "object", properties: { workOrderId: { type: "string" }, status: { type: "string" } }, required: ["workOrderId", "status"] },
    roles: ["manager", "admin"],
  },
  {
    id: "hr.travel.submit",
    name: "HR 출장 신청 제출",
    description: "HR Adapter 계약 예시입니다. R3 승인과 HR Sandbox가 없어 비활성화되어 있습니다.",
    riskLevel: "R3",
    mode: "write",
    adapterType: "external",
    enabled: 0,
    timeoutMs: 5000,
    maxRetries: 0,
    inputSchema: { type: "object", properties: { requestId: { type: "string" } }, required: ["requestId"] },
    roles: ["user", "manager", "admin"],
  },
] as const;

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function riskRequiresApproval(risk: RiskLevel) {
  return RISK_WEIGHT[risk] >= RISK_WEIGHT.R2;
}

function mapTool(row: ToolRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    riskLevel: row.risk_level,
    mode: row.mode,
    adapterType: row.adapter_type,
    enabled: Boolean(row.enabled),
    approvalRequired: riskRequiresApproval(row.risk_level),
    timeoutMs: row.timeout_ms,
    maxRetries: row.max_retries,
    inputSchema: parseJson<Record<string, unknown>>(row.input_schema_json, {}),
    requiredRoles: parseJson<UserRole[]>(row.required_roles_json, []),
  };
}

function mapRun(row: RunRow) {
  return {
    id: row.id,
    title: row.title,
    objective: row.objective,
    status: row.status,
    currentState: row.current_state,
    selectedToolId: row.selected_tool_id || undefined,
    maxIterations: row.max_iterations,
    iterationCount: row.iteration_count,
    output: parseJson<Record<string, unknown> | undefined>(row.output_json, undefined),
    error: row.error_code ? { code: row.error_code, message: row.error_message || "Agent 실행 오류" } : undefined,
    traceId: row.trace_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || undefined,
  };
}

function mapApproval(row: ApprovalRow) {
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    toolId: row.tool_id,
    toolName: row.tool_name || row.tool_id,
    riskLevel: row.risk_level || "R2",
    mode: row.mode || "read_only",
    requesterEmail: row.requester_email,
    objective: row.objective,
    runStatus: row.run_status,
    status: row.status,
    reason: row.reason,
    input: parseJson<Record<string, unknown>>(row.input_json, {}),
    decisionBy: row.decision_by || undefined,
    decisionNote: row.decision_note || undefined,
    decidedAt: row.decided_at || undefined,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

let schemaPromise: Promise<void> | undefined;

export function ensureAgentSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = getD1();
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS tool_registry (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '*', name TEXT NOT NULL,
          description TEXT NOT NULL, risk_level TEXT NOT NULL DEFAULT 'R0',
          mode TEXT NOT NULL DEFAULT 'read_only', adapter_type TEXT NOT NULL DEFAULT 'builtin',
          enabled INTEGER NOT NULL DEFAULT 0, timeout_ms INTEGER NOT NULL DEFAULT 3000,
          max_retries INTEGER NOT NULL DEFAULT 0, input_schema_json TEXT NOT NULL DEFAULT '{}',
          required_roles_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS agent_runs (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_email TEXT NOT NULL,
          title TEXT NOT NULL, objective TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
          current_state TEXT NOT NULL DEFAULT 'router', selected_tool_id TEXT,
          max_iterations INTEGER NOT NULL DEFAULT 5, iteration_count INTEGER NOT NULL DEFAULT 0,
          idempotency_key TEXT NOT NULL, input_json TEXT, output_json TEXT,
          error_code TEXT, error_message TEXT, trace_id TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
          FOREIGN KEY(selected_tool_id) REFERENCES tool_registry(id)
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS agent_steps (
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL, sequence INTEGER NOT NULL,
          step_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', tool_id TEXT,
          trace_id TEXT NOT NULL, input_json TEXT, output_json TEXT, error_code TEXT,
          error_message TEXT, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL,
          FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
          FOREIGN KEY(tool_id) REFERENCES tool_registry(id)
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS tool_approval_requests (
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL, step_id TEXT NOT NULL, tool_id TEXT NOT NULL,
          requester_email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', reason TEXT NOT NULL,
          input_json TEXT NOT NULL DEFAULT '{}', decision_by TEXT, decision_note TEXT, decided_at TEXT,
          expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
          FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
          FOREIGN KEY(step_id) REFERENCES agent_steps(id) ON DELETE CASCADE,
          FOREIGN KEY(tool_id) REFERENCES tool_registry(id)
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS tool_executions (
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL, step_id TEXT NOT NULL, tool_id TEXT NOT NULL,
          approval_request_id TEXT, idempotency_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
          attempt_count INTEGER NOT NULL DEFAULT 0, input_json TEXT NOT NULL DEFAULT '{}', output_json TEXT,
          error_code TEXT, error_message TEXT, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL,
          FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
          FOREIGN KEY(step_id) REFERENCES agent_steps(id) ON DELETE CASCADE,
          FOREIGN KEY(tool_id) REFERENCES tool_registry(id),
          FOREIGN KEY(approval_request_id) REFERENCES tool_approval_requests(id)
        )`),
      ]);
      await db.batch([
        db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_owner_idempotency_uidx ON agent_runs(tenant_id, owner_email, idempotency_key)"),
        db.prepare("CREATE INDEX IF NOT EXISTS agent_runs_owner_created_idx ON agent_runs(tenant_id, owner_email, created_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS agent_runs_status_updated_idx ON agent_runs(status, updated_at)"),
        db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS agent_steps_run_sequence_uidx ON agent_steps(run_id, sequence)"),
        db.prepare("CREATE INDEX IF NOT EXISTS agent_steps_run_status_idx ON agent_steps(run_id, status)"),
        db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS tool_approval_requests_run_step_uidx ON tool_approval_requests(run_id, step_id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS tool_approval_requests_status_expires_idx ON tool_approval_requests(status, expires_at)"),
        db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS tool_executions_idempotency_uidx ON tool_executions(idempotency_key)"),
        db.prepare("CREATE INDEX IF NOT EXISTS tool_executions_run_status_idx ON tool_executions(run_id, status)"),
        db.prepare("CREATE INDEX IF NOT EXISTS tool_registry_enabled_risk_idx ON tool_registry(enabled, risk_level)"),
        db.prepare("CREATE INDEX IF NOT EXISTS tool_registry_adapter_idx ON tool_registry(adapter_type)"),
      ]);
      const timestamp = nowIso();
      await db.batch(TOOL_SEEDS.map((tool) => db.prepare(`INSERT INTO tool_registry
        (id, tenant_id, name, description, risk_level, mode, adapter_type, enabled, timeout_ms,
          max_retries, input_schema_json, required_roles_json, created_at, updated_at)
        VALUES (?, '*', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
          risk_level = excluded.risk_level, mode = excluded.mode, adapter_type = excluded.adapter_type,
          enabled = excluded.enabled, timeout_ms = excluded.timeout_ms, max_retries = excluded.max_retries,
          input_schema_json = excluded.input_schema_json, required_roles_json = excluded.required_roles_json,
          updated_at = excluded.updated_at`).bind(
          tool.id,
          tool.name,
          tool.description,
          tool.riskLevel,
          tool.mode,
          tool.adapterType,
          tool.enabled,
          tool.timeoutMs,
          tool.maxRetries,
          JSON.stringify(tool.inputSchema),
          JSON.stringify(tool.roles),
          timestamp,
          timestamp,
        )));
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

async function findTool(toolId: string) {
  await ensureAgentSchema();
  return getD1().prepare("SELECT * FROM tool_registry WHERE id = ?").bind(toolId).first<ToolRow>();
}

async function findRun(principal: Principal, runId: string) {
  await ensureAgentSchema();
  const row = await getD1().prepare(`SELECT * FROM agent_runs WHERE id = ? AND tenant_id = ?
    AND (owner_email = ? OR ? IN ('manager', 'admin'))`).bind(
      runId,
      principal.tenantId,
      principal.email,
      principal.role,
    ).first<RunRow>();
  if (!row) throw new AgentError("Agent 작업을 찾지 못했습니다.", 404, "AGENT_RUN_NOT_FOUND");
  return row;
}

function assertToolPermission(principal: Principal, tool: ToolRow) {
  const roles = parseJson<UserRole[]>(tool.required_roles_json, []);
  if (roles.length && !roles.includes(principal.role)) {
    throw new AgentError("이 Tool을 실행할 권한이 없습니다.", 403, "TOOL_ROLE_FORBIDDEN");
  }
  if (!tool.enabled || tool.adapter_type !== "builtin") {
    throw new AgentError("외부 Adapter가 연결되지 않아 이 Tool은 비활성 상태입니다.", 409, "TOOL_DISABLED");
  }
}

type ToolInputSchema = {
  type?: string;
  properties?: Record<string, { type?: string; minLength?: number; maxLength?: number }>;
  required?: string[];
  additionalProperties?: boolean;
};

// Tool Invocation Guard: 모델이 생성한 Tool 호출 인자를 tool_registry.input_schema_json
// 기준으로 검증한다(08 §8.3 "Tool Invocation Guard"). ajv 등 외부 의존성 없이 이 프로젝트의
// inputSchema가 실제로 사용하는 부분집합(type/properties/required/minLength/maxLength/
// additionalProperties)만 검증한다.
function validateToolInput(schema: ToolInputSchema, input: Record<string, unknown>): string[] {
  if (schema.type && schema.type !== "object") return [];
  const errors: string[] = [];
  const properties = schema.properties || {};
  for (const key of schema.required || []) {
    if (input[key] === undefined || input[key] === null) errors.push(`필수 필드 누락: ${key}`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(input)) {
      if (!(key in properties)) errors.push(`허용되지 않은 필드: ${key}`);
    }
  }
  for (const [key, propSchema] of Object.entries(properties)) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (propSchema.type === "string") {
      if (typeof value !== "string") {
        errors.push(`${key}는 문자열이어야 합니다.`);
        continue;
      }
      if (propSchema.minLength !== undefined && value.length < propSchema.minLength) {
        errors.push(`${key}는 최소 ${propSchema.minLength}자여야 합니다.`);
      }
      if (propSchema.maxLength !== undefined && value.length > propSchema.maxLength) {
        errors.push(`${key}는 최대 ${propSchema.maxLength}자를 초과할 수 없습니다.`);
      }
    }
  }
  return errors;
}

async function assertToolInputSchema(input: {
  principal: Principal;
  run: RunRow;
  tool: ToolRow;
  toolInput: Record<string, unknown>;
}) {
  const schema = parseJson<ToolInputSchema>(input.tool.input_schema_json, {});
  const errors = validateToolInput(schema, input.toolInput);
  if (!errors.length) return;
  await audit({
    principal: input.principal,
    action: "tool.input_schema_violation",
    resourceType: "tool_execution",
    resourceId: input.tool.id,
    traceId: input.run.trace_id,
    outcome: "failure",
    details: { runId: input.run.id, toolId: input.tool.id, errors },
  });
  throw new AgentError(`Tool 입력값이 정책을 위반했습니다: ${errors.join(", ")}`, 400, "TOOL_INPUT_SCHEMA_VIOLATION");
}

function routeTool(objective: string) {
  if (/(승인|통제|변경.*증빙|approval|controlled)/i.test(objective)) return "controlled.change_evidence";
  if (/(검색|문서|규정|근거|citation|search)/i.test(objective)) return "knowledge.search";
  return "platform.rag_status";
}

async function insertStep(input: {
  run: RunRow;
  state: AgentState;
  sequence: number;
  status?: string;
  toolId?: string;
  stepInput?: Record<string, unknown>;
  output?: Record<string, unknown>;
}) {
  const timestamp = nowIso();
  const stepId = id("step");
  await getD1().prepare(`INSERT INTO agent_steps
    (id, run_id, sequence, step_type, status, tool_id, trace_id, input_json, output_json,
      started_at, completed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      stepId,
      input.run.id,
      input.sequence,
      input.state,
      input.status || "completed",
      input.toolId || null,
      input.run.trace_id,
      input.stepInput ? JSON.stringify(input.stepInput) : null,
      input.output ? JSON.stringify(input.output) : null,
      timestamp,
      input.status && input.status !== "completed" ? null : timestamp,
      timestamp,
    ).run();
  return stepId;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function runBuiltinTool(input: {
  principal: Principal;
  tool: ToolRow;
  toolInput: Record<string, unknown>;
  objective: string;
  traceId: string;
  approvalId?: string;
}) {
  if (input.tool.id === "platform.rag_status") {
    const db = getD1();
    const counts = await db.prepare(`SELECT COUNT(*) AS asset_count, COALESCE(SUM(segment_count), 0) AS segment_count
      FROM assets WHERE tenant_id = ? AND deleted_at IS NULL
        AND (? = 'admin' OR classification = 'public' OR department_scope = '*'
          OR instr(',' || department_scope || ',', ',' || ? || ',') > 0)`).bind(
        input.principal.tenantId,
        input.principal.role,
        input.principal.department,
      ).first<{ asset_count: number; segment_count: number }>();
    return {
      summary: `접근 가능한 문서 ${Number(counts?.asset_count || 0)}건, 세그먼트 ${Number(counts?.segment_count || 0)}건입니다.`,
      rag: getRagStatus(),
      assets: Number(counts?.asset_count || 0),
      segments: Number(counts?.segment_count || 0),
      externalWrite: false,
    };
  }
  if (input.tool.id === "knowledge.search") {
    const query = String(input.toolInput.query || input.objective).trim().slice(0, 1000);
    if (query.length < 2) throw new AgentError("검색어는 두 글자 이상이어야 합니다.", 400, "INVALID_TOOL_INPUT");
    const result = await searchRag(query, { principal: input.principal, limit: 5, traceId: input.traceId });
    return {
      summary: result.grounded
        ? `${result.citations.length}개의 권한 검증 근거를 찾았습니다.`
        : "권한 범위에서 충분한 근거를 찾지 못했습니다.",
      query,
      grounded: result.grounded,
      citations: result.citations.map((citation) => ({
        id: citation.id,
        assetId: citation.assetId,
        segmentId: citation.segmentId,
        title: citation.title,
        excerpt: citation.excerpt,
        score: citation.score,
      })),
      latencyMs: result.latencyMs,
      externalWrite: false,
    };
  }
  if (input.tool.id === "controlled.change_evidence") {
    return {
      summary: "명시적 승인과 멱등성 검사를 통과한 읽기 전용 Demo 증빙을 생성했습니다.",
      requestedChange: String(input.toolInput.change || input.objective).slice(0, 1000),
      approvalId: input.approvalId,
      executionMode: "read_only_demo",
      externalWrite: false,
      disclaimer: "ERP·MES·HR·ITSM에는 어떤 변경도 전송되지 않았습니다.",
    };
  }
  throw new AgentError("등록된 built-in 실행기를 찾지 못했습니다.", 500, "TOOL_EXECUTOR_MISSING");
}

async function executeWithTimeout<T>(operation: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AgentError("Tool 실행 제한 시간을 초과했습니다.", 504, "TOOL_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function executeTool(input: {
  principal: Principal;
  run: RunRow;
  stepId: string;
  tool: ToolRow;
  toolInput: Record<string, unknown>;
  approvalId?: string;
}) {
  assertToolPermission(input.principal, input.tool);
  await assertToolInputSchema({ principal: input.principal, run: input.run, tool: input.tool, toolInput: input.toolInput });
  const executionKey = await sha256(`${input.run.id}:${input.stepId}:${input.tool.id}:${JSON.stringify(input.toolInput)}`);
  const existing = await getD1().prepare("SELECT status, output_json, error_code, error_message FROM tool_executions WHERE idempotency_key = ?")
    .bind(executionKey).first<{ status: string; output_json: string | null; error_code: string | null; error_message: string | null }>();
  if (existing?.status === "completed") return parseJson<Record<string, unknown>>(existing.output_json, {});
  if (existing) throw new AgentError(existing.error_message || "동일 Tool 실행이 이미 처리 중이거나 실패했습니다.", 409, existing.error_code || "TOOL_EXECUTION_EXISTS");

  const executionId = id("exec");
  const startedAt = nowIso();
  await getD1().prepare(`INSERT INTO tool_executions
    (id, run_id, step_id, tool_id, approval_request_id, idempotency_key, status, attempt_count,
      input_json, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 'running', 0, ?, ?, ?)`)
    .bind(
      executionId,
      input.run.id,
      input.stepId,
      input.tool.id,
      input.approvalId || null,
      executionKey,
      JSON.stringify(input.toolInput),
      startedAt,
      startedAt,
    ).run();

  let lastError: unknown;
  const attempts = Math.max(1, Math.min(input.tool.max_retries + 1, 3));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await getD1().prepare("UPDATE tool_executions SET attempt_count = ? WHERE id = ?").bind(attempt, executionId).run();
    try {
      const output = await executeWithTimeout(
        runBuiltinTool({
          principal: input.principal,
          tool: input.tool,
          toolInput: input.toolInput,
          objective: input.run.objective,
          traceId: input.run.trace_id,
          approvalId: input.approvalId,
        }),
        Math.min(Math.max(input.tool.timeout_ms, 250), 15000),
      );
      const completedAt = nowIso();
      await getD1().prepare(`UPDATE tool_executions SET status = 'completed', output_json = ?,
        completed_at = ? WHERE id = ?`).bind(JSON.stringify(output), completedAt, executionId).run();
      await audit({
        principal: input.principal,
        action: "tool.executed",
        resourceType: "tool_execution",
        resourceId: executionId,
        traceId: input.run.trace_id,
        details: { runId: input.run.id, toolId: input.tool.id, riskLevel: input.tool.risk_level, attempt },
      });
      return output;
    } catch (error) {
      lastError = error;
      const retryable = error instanceof AgentError
        ? error.code === "TOOL_TIMEOUT" || error.status >= 500
        : true;
      if (!retryable || attempt >= attempts) break;
    }
  }

  const failure = lastError instanceof AgentError
    ? lastError
    : new AgentError("Tool 실행에 실패했습니다.", 500, "TOOL_EXECUTION_FAILED");
  await getD1().prepare(`UPDATE tool_executions SET status = 'failed', error_code = ?,
    error_message = ?, completed_at = ? WHERE id = ?`).bind(
      failure.code,
      failure.message,
      nowIso(),
      executionId,
    ).run();
  await audit({
    principal: input.principal,
    action: "tool.failed",
    resourceType: "tool_execution",
    resourceId: executionId,
    traceId: input.run.trace_id,
    outcome: "failure",
    details: { runId: input.run.id, toolId: input.tool.id, code: failure.code },
  });
  throw failure;
}

async function createApproval(input: {
  principal: Principal;
  run: RunRow;
  stepId: string;
  tool: ToolRow;
  toolInput: Record<string, unknown>;
}) {
  const approvalId = id("apr");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
  await getD1().prepare(`INSERT INTO tool_approval_requests
    (id, run_id, step_id, tool_id, requester_email, status, reason, input_json, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`).bind(
      approvalId,
      input.run.id,
      input.stepId,
      input.tool.id,
      input.principal.email,
      `${input.tool.risk_level} Tool은 실행 전 관리자 또는 매니저의 명시적 승인이 필요합니다.`,
      JSON.stringify(input.toolInput),
      expiresAt,
      createdAt,
    ).run();
  await audit({
    principal: input.principal,
    action: "tool.approval_requested",
    resourceType: "tool_approval_request",
    resourceId: approvalId,
    traceId: input.run.trace_id,
    details: { runId: input.run.id, toolId: input.tool.id, riskLevel: input.tool.risk_level, expiresAt },
  });
  await createScheduleWorkItem({
    principal: input.principal,
    title: `Tool 승인: ${input.tool.name}`,
    description: input.run.objective,
    kind: "reminder",
    priority: "urgent",
    dueAt: expiresAt,
    sourceType: "tool_approval_request",
    sourceId: approvalId,
    autoGenerated: true,
    notifyEnabled: true,
    metadata: { runId: input.run.id, toolId: input.tool.id },
  }).catch((error) => console.error("[agent] approval schedule registration failed", error));
  return approvalId;
}

async function failRun(principal: Principal, run: RunRow, error: unknown, stepId?: string) {
  const failure = error instanceof AgentError
    ? error
    : new AgentError("Agent 실행에 실패했습니다.", 500, "AGENT_RUN_FAILED");
  const timestamp = nowIso();
  const db = getD1();
  const statements = [db.prepare(`UPDATE agent_runs SET status = 'failed', error_code = ?, error_message = ?,
    updated_at = ?, completed_at = ? WHERE id = ?`).bind(failure.code, failure.message, timestamp, timestamp, run.id)];
  if (stepId) statements.push(db.prepare(`UPDATE agent_steps SET status = 'failed', error_code = ?, error_message = ?,
    completed_at = ? WHERE id = ?`).bind(failure.code, failure.message, timestamp, stepId));
  await db.batch(statements);
  await audit({
    principal,
    action: "agent.run_failed",
    resourceType: "agent_run",
    resourceId: run.id,
    traceId: run.trace_id,
    outcome: "failure",
    details: { code: failure.code, message: failure.message },
  });
  await syncScheduleWorkItemStatus(principal, "agent_run", run.id, "failed")
    .catch((scheduleError) => console.error("[agent] failed-run schedule sync failed", scheduleError));
  throw failure;
}

async function orchestrate(principal: Principal, initialRun: RunRow) {
  let run = initialRun;
  let activeStepId: string | undefined;
  try {
    while (run.iteration_count < run.max_iterations) {
      const input = parseJson<{ toolId?: string; toolInput?: Record<string, unknown> }>(run.input_json, {});
      const sequence = run.iteration_count + 1;
      const state = run.current_state;
      if (state === "router") {
        const toolId = input.toolId || routeTool(run.objective);
        const tool = await findTool(toolId);
        if (!tool) throw new AgentError("요청한 Tool을 찾지 못했습니다.", 404, "TOOL_NOT_FOUND");
        assertToolPermission(principal, tool);
        activeStepId = await insertStep({ run, state, sequence, output: { selectedToolId: tool.id, reason: "정책 기반 Router 선택" } });
        await getD1().prepare(`UPDATE agent_runs SET selected_tool_id = ?, current_state = 'planner',
          status = 'running', iteration_count = ?, updated_at = ? WHERE id = ?`).bind(tool.id, sequence, nowIso(), run.id).run();
      } else if (state === "planner") {
        activeStepId = await insertStep({
          run,
          state,
          sequence,
          toolId: run.selected_tool_id || undefined,
          output: { plan: ["retrieval", "verification", "execution"], maxIterations: run.max_iterations },
        });
        await getD1().prepare(`UPDATE agent_runs SET current_state = 'retrieval', iteration_count = ?,
          updated_at = ? WHERE id = ?`).bind(sequence, nowIso(), run.id).run();
      } else if (state === "retrieval") {
        activeStepId = await insertStep({
          run,
          state,
          sequence,
          toolId: run.selected_tool_id || undefined,
          output: { principalScope: { tenantId: principal.tenantId, department: principal.department }, contextReady: true },
        });
        await getD1().prepare(`UPDATE agent_runs SET current_state = 'verification', iteration_count = ?,
          updated_at = ? WHERE id = ?`).bind(sequence, nowIso(), run.id).run();
      } else if (state === "verification") {
        const tool = await findTool(run.selected_tool_id || "");
        if (!tool) throw new AgentError("선택된 Tool을 찾지 못했습니다.", 404, "TOOL_NOT_FOUND");
        assertToolPermission(principal, tool);
        activeStepId = await insertStep({
          run,
          state,
          sequence,
          toolId: tool.id,
          output: {
            riskLevel: tool.risk_level,
            approvalRequired: riskRequiresApproval(tool.risk_level),
            adapterType: tool.adapter_type,
            enabled: Boolean(tool.enabled),
            policyPassed: true,
          },
        });
        await getD1().prepare(`UPDATE agent_runs SET current_state = 'execution', iteration_count = ?,
          updated_at = ? WHERE id = ?`).bind(sequence, nowIso(), run.id).run();
      } else {
        const tool = await findTool(run.selected_tool_id || "");
        if (!tool) throw new AgentError("선택된 Tool을 찾지 못했습니다.", 404, "TOOL_NOT_FOUND");
        const toolInput = input.toolInput || {};
        if (riskRequiresApproval(tool.risk_level)) {
          activeStepId = await insertStep({ run, state, sequence, status: "waiting_approval", toolId: tool.id, stepInput: toolInput });
          const approvalId = await createApproval({ principal, run, stepId: activeStepId, tool, toolInput });
          await getD1().prepare(`UPDATE agent_runs SET status = 'awaiting_approval', iteration_count = ?,
            output_json = ?, updated_at = ? WHERE id = ?`).bind(
              sequence,
              JSON.stringify({ summary: "명시적 Tool 승인을 기다리고 있습니다.", approvalId }),
              nowIso(),
              run.id,
            ).run();
          return getAgentRun(principal, run.id);
        }
        activeStepId = await insertStep({ run, state, sequence, status: "running", toolId: tool.id, stepInput: toolInput });
        const output = await executeTool({ principal, run, stepId: activeStepId, tool, toolInput });
        const completedAt = nowIso();
        await getD1().batch([
          getD1().prepare(`UPDATE agent_steps SET status = 'completed', output_json = ?, completed_at = ? WHERE id = ?`)
            .bind(JSON.stringify(output), completedAt, activeStepId),
          getD1().prepare(`UPDATE agent_runs SET status = 'completed', iteration_count = ?, output_json = ?,
            updated_at = ?, completed_at = ? WHERE id = ?`).bind(sequence, JSON.stringify(output), completedAt, completedAt, run.id),
        ]);
        await audit({
          principal,
          action: "agent.run_completed",
          resourceType: "agent_run",
          resourceId: run.id,
          traceId: run.trace_id,
          details: { toolId: tool.id, iterations: sequence },
        });
        await syncScheduleWorkItemStatus(principal, "agent_run", run.id, "done")
          .catch((scheduleError) => console.error("[agent] completed-run schedule sync failed", scheduleError));
        return getAgentRun(principal, run.id);
      }
      run = await findRun(principal, run.id);
    }
    throw new AgentError("Agent의 최대 반복 횟수에 도달했습니다.", 409, "AGENT_MAX_ITERATIONS");
  } catch (error) {
    return failRun(principal, run, error, activeStepId);
  }
}

export async function listTools(principal: Principal) {
  await ensureAgentSchema();
  const rows = await getD1().prepare("SELECT * FROM tool_registry WHERE tenant_id IN ('*', ?) ORDER BY enabled DESC, risk_level, name")
    .bind(principal.tenantId).all<ToolRow>();
  return (rows.results || []).map(mapTool).map((tool) => ({
    ...tool,
    availableToCurrentRole: tool.requiredRoles.length === 0 || tool.requiredRoles.includes(principal.role),
  }));
}

export async function createAgentRun(input: {
  principal: Principal;
  objective: string;
  toolId?: string;
  toolInput?: Record<string, unknown>;
  idempotencyKey: string;
  traceId: string;
}) {
  await ensureAgentSchema();
  const objective = input.objective.trim().slice(0, 2000);
  const idempotencyKey = input.idempotencyKey.trim().slice(0, 200);
  if (objective.length < 2) throw new AgentError("Agent 목표는 두 글자 이상이어야 합니다.", 400, "INVALID_AGENT_OBJECTIVE");
  if (!idempotencyKey) throw new AgentError("Idempotency-Key가 필요합니다.", 400, "IDEMPOTENCY_KEY_REQUIRED");
  if (input.toolId) {
    const tool = await findTool(input.toolId);
    if (!tool) throw new AgentError("요청한 Tool을 찾지 못했습니다.", 404, "TOOL_NOT_FOUND");
    assertToolPermission(input.principal, tool);
  }

  const runId = id("run");
  const timestamp = nowIso();
  await getD1().prepare(`INSERT OR IGNORE INTO agent_runs
    (id, tenant_id, owner_email, title, objective, status, current_state, max_iterations,
      iteration_count, idempotency_key, input_json, trace_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'queued', 'router', ?, 0, ?, ?, ?, ?, ?)`).bind(
      runId,
      input.principal.tenantId,
      input.principal.email,
      objective.slice(0, 80),
      objective,
      MAX_AGENT_ITERATIONS,
      idempotencyKey,
      JSON.stringify({ toolId: input.toolId, toolInput: input.toolInput || {} }),
      input.traceId,
      timestamp,
      timestamp,
    ).run();
  const row = await getD1().prepare(`SELECT * FROM agent_runs WHERE tenant_id = ? AND owner_email = ?
    AND idempotency_key = ?`).bind(input.principal.tenantId, input.principal.email, idempotencyKey).first<RunRow>();
  if (!row) throw new AgentError("Agent 작업을 생성하지 못했습니다.", 500, "AGENT_RUN_CREATE_FAILED");
  if (row.id !== runId) return { reused: true, run: await getAgentRun(input.principal, row.id) };
  await audit({
    principal: input.principal,
    action: "agent.run_created",
    resourceType: "agent_run",
    resourceId: runId,
    traceId: input.traceId,
    details: { objective: objective.slice(0, 200), requestedToolId: input.toolId },
  });
  await createScheduleWorkItem({
    principal: input.principal,
    title: `Agent: ${objective.slice(0, 120)}`,
    description: objective,
    kind: "execution",
    sourceType: "agent_run",
    sourceId: runId,
    autoGenerated: true,
    notifyEnabled: false,
  }).catch((error) => console.error("[agent] run schedule registration failed", error));
  return { reused: false, run: await orchestrate(input.principal, row) };
}

export async function listAgentRuns(principal: Principal, options?: { tenantScope?: boolean; limit?: number }) {
  await ensureAgentSchema();
  const tenantScope = Boolean(options?.tenantScope && (principal.role === "manager" || principal.role === "admin"));
  const limit = Math.min(Math.max(options?.limit || 50, 1), 100);
  const rows = tenantScope
    ? await getD1().prepare("SELECT * FROM agent_runs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?")
      .bind(principal.tenantId, limit).all<RunRow>()
    : await getD1().prepare("SELECT * FROM agent_runs WHERE tenant_id = ? AND owner_email = ? ORDER BY created_at DESC LIMIT ?")
      .bind(principal.tenantId, principal.email, limit).all<RunRow>();
  return (rows.results || []).map(mapRun);
}

export async function getAgentRun(principal: Principal, runId: string) {
  const run = await findRun(principal, runId);
  const db = getD1();
  const [steps, approvals, executions] = await Promise.all([
    db.prepare("SELECT * FROM agent_steps WHERE run_id = ? ORDER BY sequence").bind(run.id).all(),
    db.prepare(`SELECT a.*, t.name AS tool_name, t.risk_level, t.mode FROM tool_approval_requests a
      JOIN tool_registry t ON t.id = a.tool_id WHERE a.run_id = ? ORDER BY a.created_at`).bind(run.id).all<ApprovalRow>(),
    db.prepare("SELECT * FROM tool_executions WHERE run_id = ? ORDER BY created_at").bind(run.id).all(),
  ]);
  return {
    ...mapRun(run),
    steps: (steps.results || []).map((step) => ({
      id: String(step.id),
      sequence: Number(step.sequence),
      stepType: String(step.step_type),
      status: String(step.status),
      toolId: step.tool_id ? String(step.tool_id) : undefined,
      output: parseJson<Record<string, unknown> | undefined>(step.output_json ? String(step.output_json) : undefined, undefined),
      error: step.error_code ? { code: String(step.error_code), message: String(step.error_message || "") } : undefined,
      startedAt: step.started_at ? String(step.started_at) : undefined,
      completedAt: step.completed_at ? String(step.completed_at) : undefined,
    })),
    approvals: (approvals.results || []).map(mapApproval),
    executions: (executions.results || []).map((execution) => ({
      id: String(execution.id),
      toolId: String(execution.tool_id),
      status: String(execution.status),
      attemptCount: Number(execution.attempt_count),
      output: parseJson<Record<string, unknown> | undefined>(execution.output_json ? String(execution.output_json) : undefined, undefined),
      error: execution.error_code ? { code: String(execution.error_code), message: String(execution.error_message || "") } : undefined,
      startedAt: execution.started_at ? String(execution.started_at) : undefined,
      completedAt: execution.completed_at ? String(execution.completed_at) : undefined,
    })),
  };
}

export async function listToolApprovals(principal: Principal, limit = 100) {
  await ensureAgentSchema();
  const db = getD1();
  const timestamp = nowIso();
  await db.prepare(`UPDATE tool_approval_requests SET status = 'expired'
    WHERE status = 'pending' AND expires_at <= ?`).bind(timestamp).run();
  const elevated = principal.role === "manager" || principal.role === "admin";
  const rows = await db.prepare(`SELECT a.*, r.objective, r.status AS run_status,
      t.name AS tool_name, t.risk_level, t.mode
    FROM tool_approval_requests a
    JOIN agent_runs r ON r.id = a.run_id
    JOIN tool_registry t ON t.id = a.tool_id
    WHERE r.tenant_id = ? AND (? = 1 OR a.requester_email = ?)
    ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.created_at DESC LIMIT ?`).bind(
      principal.tenantId,
      elevated ? 1 : 0,
      principal.email,
      Math.min(Math.max(limit, 1), 200),
    ).all<ApprovalRow>();
  return (rows.results || []).map(mapApproval);
}

export async function decideToolApproval(input: {
  principal: Principal;
  approvalId: string;
  decision: "approved" | "rejected";
  note?: string;
  traceId: string;
}) {
  if (input.principal.role !== "manager" && input.principal.role !== "admin") {
    throw new AgentError("업무 Tool 승인은 관리자 또는 매니저만 처리할 수 있습니다.", 403, "TOOL_APPROVAL_FORBIDDEN");
  }
  await ensureAgentSchema();
  const db = getD1();
  const approval = await db.prepare(`SELECT a.*, r.tenant_id, r.owner_email, r.status AS run_status,
      r.objective, r.trace_id, r.input_json, r.selected_tool_id, r.title, r.current_state,
      r.max_iterations, r.iteration_count, r.idempotency_key, r.output_json,
      r.error_code, r.error_message, r.created_at AS run_created_at,
      r.updated_at AS run_updated_at, r.completed_at,
      t.name AS tool_name, t.risk_level, t.mode
    FROM tool_approval_requests a JOIN agent_runs r ON r.id = a.run_id
    JOIN tool_registry t ON t.id = a.tool_id WHERE a.id = ? AND r.tenant_id = ?`).bind(
      input.approvalId,
      input.principal.tenantId,
    ).first<ApprovalRow & Record<string, string | number | null>>();
  if (!approval) throw new AgentError("업무 Tool 승인 요청을 찾지 못했습니다.", 404, "TOOL_APPROVAL_NOT_FOUND");
  if (approval.requester_email === input.principal.email) {
    throw new AgentError("요청자 본인은 자신의 R2 이상 Tool 실행을 승인할 수 없습니다.", 403, "TOOL_SELF_APPROVAL_FORBIDDEN");
  }
  if (approval.status !== "pending") {
    throw new AgentError("이미 처리되었거나 만료된 승인 요청입니다.", 409, "TOOL_APPROVAL_ALREADY_DECIDED");
  }
  if (approval.expires_at <= nowIso()) {
    await db.prepare("UPDATE tool_approval_requests SET status = 'expired' WHERE id = ? AND status = 'pending'")
      .bind(approval.id).run();
    throw new AgentError("승인 요청이 만료되었습니다.", 409, "TOOL_APPROVAL_EXPIRED");
  }

  const decidedAt = nowIso();
  await db.prepare(`UPDATE tool_approval_requests SET status = ?, decision_by = ?, decision_note = ?,
    decided_at = ? WHERE id = ? AND status = 'pending'`).bind(
      input.decision,
      input.principal.email,
      input.note?.trim().slice(0, 1000) || null,
      decidedAt,
      approval.id,
    ).run();
  await audit({
    principal: input.principal,
    action: input.decision === "approved" ? "tool.approval_approved" : "tool.approval_rejected",
    resourceType: "tool_approval_request",
    resourceId: approval.id,
    traceId: input.traceId,
    details: { runId: approval.run_id, toolId: approval.tool_id, requesterEmail: approval.requester_email },
  });

  if (input.decision === "rejected") {
    await deleteScheduleWorkItemsForSource(input.principal, "tool_approval_request", approval.id)
      .catch((scheduleError) => console.error("[agent] rejected-approval schedule cleanup failed", scheduleError));
    await db.batch([
      db.prepare(`UPDATE agent_steps SET status = 'cancelled', error_code = 'TOOL_APPROVAL_REJECTED',
        error_message = ?, completed_at = ? WHERE id = ?`).bind("업무 Tool 실행 승인이 거절되었습니다.", decidedAt, approval.step_id),
      db.prepare(`UPDATE agent_runs SET status = 'cancelled', error_code = 'TOOL_APPROVAL_REJECTED',
        error_message = ?, updated_at = ?, completed_at = ? WHERE id = ?`).bind(
          "업무 Tool 실행 승인이 거절되었습니다.",
          decidedAt,
          decidedAt,
          approval.run_id,
        ),
    ]);
    return { approval: mapApproval({ ...approval, status: "rejected", decision_by: input.principal.email, decision_note: input.note || null, decided_at: decidedAt }), run: await getAgentRun(input.principal, approval.run_id) };
  }

  const tool = await findTool(approval.tool_id);
  if (!tool) throw new AgentError("승인된 Tool을 찾지 못했습니다.", 404, "TOOL_NOT_FOUND");
  assertToolPermission(input.principal, tool);
  const run = await findRun(input.principal, approval.run_id);
  const toolInput = parseJson<Record<string, unknown>>(approval.input_json, {});
  try {
    await db.prepare("UPDATE agent_steps SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?")
      .bind(decidedAt, approval.step_id).run();
    const output = await executeTool({
      principal: input.principal,
      run,
      stepId: approval.step_id,
      tool,
      toolInput,
      approvalId: approval.id,
    });
    const completedAt = nowIso();
    await db.batch([
      db.prepare("UPDATE tool_approval_requests SET status = 'consumed' WHERE id = ?").bind(approval.id),
      db.prepare("UPDATE agent_steps SET status = 'completed', output_json = ?, completed_at = ? WHERE id = ?")
        .bind(JSON.stringify(output), completedAt, approval.step_id),
      db.prepare(`UPDATE agent_runs SET status = 'completed', output_json = ?, updated_at = ?,
        completed_at = ? WHERE id = ?`).bind(JSON.stringify(output), completedAt, completedAt, approval.run_id),
    ]);
    await deleteScheduleWorkItemsForSource(input.principal, "tool_approval_request", approval.id)
      .catch((scheduleError) => console.error("[agent] consumed-approval schedule cleanup failed", scheduleError));
    await syncScheduleWorkItemStatus(input.principal, "agent_run", approval.run_id, "done")
      .catch((scheduleError) => console.error("[agent] approved-run schedule sync failed", scheduleError));
    await audit({
      principal: input.principal,
      action: "agent.run_completed",
      resourceType: "agent_run",
      resourceId: approval.run_id,
      traceId: run.trace_id,
      details: { toolId: tool.id, approvalId: approval.id },
    });
    const refreshed = await listToolApprovals(input.principal);
    return { approval: refreshed.find((item) => item.id === approval.id), run: await getAgentRun(input.principal, approval.run_id) };
  } catch (error) {
    return failRun(input.principal, run, error, approval.step_id);
  }
}
