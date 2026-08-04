import { getD1 } from "../db";
import type { Principal } from "./identity";

export class GuardrailError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 413 | 429,
    public readonly code: "PROMPT_INJECTION_DETECTED" | "PAYLOAD_TOO_LARGE" | "RATE_LIMITED",
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
  await db.prepare(`INSERT INTO rate_limit_buckets (bucket_key, request_count, window_started_at, expires_at)
    VALUES (?, 1, ?, ?) ON CONFLICT(bucket_key) DO UPDATE SET request_count = request_count + 1`).bind(
      bucketKey,
      new Date(windowStart).toISOString(),
      new Date(expiresAt).toISOString(),
    ).run();
  const row = await db.prepare("SELECT request_count FROM rate_limit_buckets WHERE bucket_key = ?")
    .bind(bucketKey).first<{ request_count: number }>();
  if (Number(row?.request_count || 0) > limit) {
    throw new GuardrailError("요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.", 429, "RATE_LIMITED", Math.max(1, Math.ceil((expiresAt - now) / 1000)));
  }
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
