import { getD1, RuntimeBindingError } from "../db";
import { getRuntimeEnv } from "./runtime-env";
import type { Principal } from "./identity";

export class GuardrailError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 409 | 413 | 429,
    public readonly code:
      | "PROMPT_INJECTION_DETECTED"
      | "PAYLOAD_TOO_LARGE"
      | "RATE_LIMITED"
      | "DAILY_BUDGET_EXCEEDED"
      | "AI_KIND_DISABLED"
      | "CONVERSATION_SENSITIVITY_MISMATCH",
    public readonly retryAfter?: number,
  ) {
    super(message);
  }
}

const injectionPatterns = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /disregard\s+(the\s+)?(above|system|developer)\s+instructions?/i,
  /reveal\s+(the\s+)?(system\s+prompt|api\s*key|secret)/i,
  /시스템\s*(프롬프트|지시).{0,20}(보여|출력|공개)/i,
  /이전\s*(지시|명령).{0,10}(무시|잊어)/i,
  /<script\b/i,
];

export function inspectUserInput(value: string) {
  if (value.length > 24_000) throw new GuardrailError("요청 내용이 허용 크기를 초과했습니다.", 413, "PAYLOAD_TOO_LARGE");
  if (injectionPatterns.some((pattern) => pattern.test(value))) {
    throw new GuardrailError("보안 정책에 의해 요청이 차단되었습니다.", 400, "PROMPT_INJECTION_DETECTED");
  }
}

export function inspectDocumentContent(value: string) {
  // Applies to text extracted from an upload, not to the uploaded file. Kept in
  // step with the chunker's cap so neither becomes the effective upload limit.
  if (value.length > 20_000_000) throw new GuardrailError("문서에서 추출한 텍스트가 허용 범위를 초과했습니다.", 413, "PAYLOAD_TOO_LARGE");
  const matches = injectionPatterns.reduce((count, pattern) => count + Number(pattern.test(value)), 0);
  if (matches >= 2) {
    throw new GuardrailError("간접 Prompt Injection 위험 패턴이 반복되어 문서 등록을 차단했습니다.", 400, "PROMPT_INJECTION_DETECTED");
  }
}

// Retrieved Content Injection Scan (08 §8.3): 인덱싱 시점 검사(inspectDocumentContent)와
// 별개로, 검색된 세그먼트가 Context Builder에 편입되는 매 쿼리마다 명령성 텍스트 여부를
// 재확인한다. 업로드 차단과 달리 검색 결과는 차단하지 않고 "데이터일 뿐 지시가 아니다"라는
// 신뢰 등급 태그를 부여해 LLM이 이를 명령으로 오인하지 않도록 한다.
export function isLikelyInjectedContent(value: string): boolean {
  return injectionPatterns.some((pattern) => pattern.test(value));
}

const RRN_PATTERN = /\b\d{6}-?[1-4]\d{6}\b/g;
const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const PHONE_PATTERN = /\b01[016789]-?\d{3,4}-?\d{4}\b/g;
const CARD_PATTERN = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;

// 출력 DLP/PII 마스킹 최소셋(주민등록번호·이메일·휴대전화·카드번호). 08 §8.3.1 정책
// 매트릭스의 "출력 시점 마스킹" 조치를 실제로 수행하는 함수. 정규식 기반이라 커버리지가
// 완전하지 않으므로 control-tower.ts의 통제 상태는 "implemented"가 아닌 "in_progress"로
// 정직하게 표기한다(의미론적 탐지·전 개체 커버리지는 후속 확장 대상).
export function maskPii(value: string): string {
  return value
    .replace(RRN_PATTERN, (match) => `${match.slice(0, 6)}-*******`)
    .replace(CARD_PATTERN, (match) => match.replace(/\d(?=\d{4})/g, "*"))
    .replace(PHONE_PATTERN, (match) => match.replace(/\d(?=\d{4})/g, "*"))
    .replace(EMAIL_PATTERN, (match) => {
      const [local, domain] = match.split("@");
      const visible = local.slice(0, Math.min(2, local.length));
      return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
    });
}

/**
 * DISABLED_AI_KINDS 로 꺼둔 기능을 차단한다.
 *
 * 이 변수는 설정에 존재했지만 읽는 곳이 없었다(2026-08-04 점검). 즉 preview 의
 * "image_gen 비활성"은 문서상 선언일 뿐 실제로는 열려 있었다. 여기서 실효화한다.
 */
export function assertAiKindEnabled(kind: string) {
  const disabled = (getRuntimeEnv().DISABLED_AI_KINDS || "")
    .split(",").map((v) => v.trim()).filter(Boolean);
  if (disabled.includes(kind)) {
    throw new GuardrailError(
      "이 환경에서는 해당 AI 기능이 비활성화되어 있습니다.",
      403,
      "AI_KIND_DISABLED",
    );
  }
}

export async function enforceRateLimit(principal: Principal, route: string, limit = 60) {
  const db = getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS rate_limit_buckets (
      bucket_key TEXT PRIMARY KEY, request_count INTEGER NOT NULL,
      window_started_at TEXT NOT NULL, expires_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS rate_limit_expires_idx ON rate_limit_buckets(expires_at)"),
  ]);
  const now = Date.now();
  const windowStart = Math.floor(now / 60_000) * 60_000;
  const expiresAt = windowStart + 60_000;
  const bucketKey = `${principal.tenantId}:${principal.email}:${route}:${windowStart}`;
  await db.batch([
    db.prepare("DELETE FROM rate_limit_buckets WHERE expires_at <= ?")
      .bind(new Date(now).toISOString()),
    db.prepare(`INSERT INTO rate_limit_buckets (bucket_key, request_count, window_started_at, expires_at)
      VALUES (?, 1, ?, ?) ON CONFLICT(bucket_key) DO UPDATE SET request_count = request_count + 1`).bind(
        bucketKey,
        new Date(windowStart).toISOString(),
        new Date(expiresAt).toISOString(),
      ),
  ]);
  const row = await db.prepare("SELECT request_count FROM rate_limit_buckets WHERE bucket_key = ?")
    .bind(bucketKey).first<{ request_count: number }>();
  if (Number(row?.request_count || 0) > limit) {
    throw new GuardrailError("요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.", 429, "RATE_LIMITED", Math.max(1, Math.ceil((expiresAt - now) / 1000)));
  }
}

export async function enforceEdgeRateLimit(request: Request, kind: "api" | "auth") {
  const runtime = getRuntimeEnv();
  const limiter = kind === "auth" ? runtime.AUTH_RATE_LIMITER : runtime.EDGE_RATE_LIMITER;
  if (!limiter) {
    if (runtime.EDGE_RATE_LIMIT_REQUIRED !== "false" && (runtime.APP_ENV === "production" || runtime.APP_ENV === "preview")) {
      throw new RuntimeBindingError(kind === "auth" ? "AUTH_RATE_LIMITER" : "EDGE_RATE_LIMITER");
    }
    return;
  }

  const url = new URL(request.url);
  const ip = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
  const { success } = await limiter.limit({ key: `${url.hostname}:${ip}` });
  if (!success) {
    throw new GuardrailError(
      "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
      429,
      "RATE_LIMITED",
      60,
    );
  }
}

// ── 일일 예산 (2026-08-04) ────────────────────────────────────────────────
// 분당 제한은 순간 폭주만 막는다. 60 req/분을 하루 내내 유지하면 8.6만 건이고
// 그건 청구서로 돌아온다. 사용자별·테넌트별 일일 상한을 따로 둔다.
//
// 비용 단위는 "요청 수"가 아니라 weight 다. 이미지 1장이 채팅 1건과 같은 무게일
// 수 없다. 뉴런 실측치(11 §11.4)를 반올림해 상대 가중치로 쓴다.
export const COST_WEIGHT = Object.freeze({
  chat: 1,
  tts: 2,
  image_gen: 12,
  // 화면 문구 번역. 1회 입력 상한 7,000자 · 출력 2,400토큰으로 채팅 1건보다 무겁다.
  // 화면 진입 시 배치로 나가므로 분당 한도는 넉넉히 두되 일일 예산에는 반드시 계상한다.
  ui_translation: 2,
});

function dailyLimits() {
  const env = getRuntimeEnv();
  const num = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  };
  return {
    // 사람이 하루에 채팅 400건을 정상 업무로 쓰기는 어렵다. 그 위는 자동화다.
    perUser: num(env.DAILY_BUDGET_PER_USER, 400),
    // 전사 상한. 계정 전체가 폭주해도 여기서 멈춘다.
    perTenant: num(env.DAILY_BUDGET_PER_TENANT, 5_000),
  };
}

async function ensureBudgetSchema() {
  const db = getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ai_budget_buckets (
      bucket_key TEXT PRIMARY KEY, spent INTEGER NOT NULL,
      day TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS ai_budget_day_idx ON ai_budget_buckets(day)"),
  ]);
}

async function spend(bucketKey: string, day: string, weight: number) {
  const db = getD1();
  await db.prepare(`INSERT INTO ai_budget_buckets (bucket_key, spent, day, updated_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(bucket_key) DO UPDATE SET
      spent = spent + excluded.spent, updated_at = excluded.updated_at`)
    .bind(bucketKey, weight, day, new Date().toISOString()).run();
  const row = await db.prepare("SELECT spent FROM ai_budget_buckets WHERE bucket_key = ?")
    .bind(bucketKey).first<{ spent: number }>();
  return Number(row?.spent || 0);
}

/**
 * AI 호출 전에 일일 예산을 차감한다. 초과하면 429 로 막는다.
 *
 * 호출 전에 차감하는 이유: 응답을 받은 뒤 기록하면 실패한 호출의 비용이 장부에서
 * 빠진다. 뉴런은 실패해도 소모된다. 낙관적 차감이 회계상 맞다.
 */
export async function enforceDailyBudget(
  principal: Principal,
  kind: keyof typeof COST_WEIGHT,
) {
  await ensureBudgetSchema();
  const limits = dailyLimits();
  const weight = COST_WEIGHT[kind];
  const day = new Date().toISOString().slice(0, 10);

  const perUser = await resolveUserLimit(principal, limits.perUser);
  const userSpent = await spend(`u:${principal.tenantId}:${principal.email}:${day}`, day, weight);
  if (userSpent > perUser) {
    throw new GuardrailError(
      "오늘 사용 가능한 AI 요청 한도를 모두 사용했습니다. 내일 다시 시도하거나 관리자에게 문의해 주세요.",
      429,
      "DAILY_BUDGET_EXCEEDED",
      secondsUntilUtcMidnight(),
    );
  }

  const tenantSpent = await spend(`t:${principal.tenantId}:${day}`, day, weight);
  if (tenantSpent > limits.perTenant) {
    throw new GuardrailError(
      "전사 일일 AI 사용 한도에 도달했습니다. 관리자에게 문의해 주세요.",
      429,
      "DAILY_BUDGET_EXCEEDED",
      secondsUntilUtcMidnight(),
    );
  }
}

function secondsUntilUtcMidnight() {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}

/**
 * 조직별 한도 오버라이드. 환경변수 기본값 위에 관리자가 법인·부서 단위로 덮어쓴다.
 * 부서 값이 있으면 부서 우선, 없으면 법인, 그것도 없으면 환경변수 기본값이다.
 */
export async function ensureBudgetPolicySchema() {
  await getD1().prepare(`CREATE TABLE IF NOT EXISTS ai_budget_policies (
    tenant_id TEXT NOT NULL, scope TEXT NOT NULL, scope_id TEXT NOT NULL,
    daily_limit INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, scope, scope_id)
  )`).run();
}

async function resolveUserLimit(principal: Principal, fallback: number) {
  const org = principal as Principal & { corpId?: string | null; deptId?: string | null };
  if (!org.corpId && !org.deptId) return fallback;
  await ensureBudgetPolicySchema();
  const row = await getD1().prepare(`SELECT daily_limit, scope FROM ai_budget_policies
    WHERE tenant_id = ? AND ((scope = 'department' AND scope_id = ?) OR (scope = 'corporation' AND scope_id = ?))
    ORDER BY scope = 'department' DESC LIMIT 1`)
    .bind(principal.tenantId, org.deptId ?? "", org.corpId ?? "")
    .first<{ daily_limit: number }>();
  return Number(row?.daily_limit) > 0 ? Number(row!.daily_limit) : fallback;
}

/** 관리자 화면용 — 오늘 소진량. 차단 없이 읽기만 한다. */
export async function readDailyBudgetUsage(tenantId: string) {
  await ensureBudgetSchema();
  const day = new Date().toISOString().slice(0, 10);
  const limits = dailyLimits();
  const db = getD1();
  const tenant = await db.prepare("SELECT spent FROM ai_budget_buckets WHERE bucket_key = ?")
    .bind(`t:${tenantId}:${day}`).first<{ spent: number }>();

  // 사용자별 상위 소진자. bucket_key 는 `u:{tenant}:{email}:{day}` 형태다.
  const top = await db.prepare(`SELECT bucket_key, spent FROM ai_budget_buckets
    WHERE day = ? AND bucket_key LIKE ? ORDER BY spent DESC LIMIT 20`)
    .bind(day, `u:${tenantId}:%`).all<{ bucket_key: string; spent: number }>();
  const [daily, organization] = await Promise.all([
    db.prepare(`SELECT day, SUM(spent) AS spent FROM ai_budget_buckets
      WHERE day >= date(?, '-6 days') AND bucket_key LIKE ?
      GROUP BY day ORDER BY day ASC`).bind(day, `t:${tenantId}:%`).all<{ day: string; spent: number }>(),
    db.prepare(`SELECT u.corp_id, u.dept_id, SUM(b.spent) AS spent
      FROM ai_budget_buckets b
      JOIN user_profiles u ON u.tenant_id = ?
        AND b.bucket_key LIKE 'u:' || u.tenant_id || ':' || u.email || ':%'
      WHERE b.day = ? AND b.bucket_key LIKE ?
      GROUP BY u.corp_id, u.dept_id ORDER BY spent DESC`).bind(tenantId, day, `u:${tenantId}:%`)
      .all<{ corp_id: string | null; dept_id: string | null; spent: number }>(),
  ]);

  return {
    day,
    tenantSpent: Number(tenant?.spent || 0),
    tenantLimit: limits.perTenant,
    perUserLimit: limits.perUser,
    daily: (daily.results ?? []).map((row) => ({ day: row.day, spent: Number(row.spent || 0) })),
    organizationUsage: (organization.results ?? []).map((row) => ({
      corpId: row.corp_id,
      deptId: row.dept_id,
      spent: Number(row.spent || 0),
    })),
    topUsers: (top.results ?? []).map((r) => ({
      email: r.bucket_key.slice(`u:${tenantId}:`.length, -(day.length + 1)),
      spent: Number(r.spent || 0),
    })),
  };
}

export function guardrailResponse(error: unknown, traceId: string) {
  if (!(error instanceof GuardrailError)) return undefined;
  const headers: Record<string, string> = { "Cache-Control": "no-store", "X-Trace-Id": traceId };
  if (error.retryAfter) headers["Retry-After"] = String(error.retryAfter);
  return Response.json(
    { error: { code: error.code, message: error.message, retryable: error.code === "RATE_LIMITED", trace_id: traceId } },
    { status: error.status, headers },
  );
}
