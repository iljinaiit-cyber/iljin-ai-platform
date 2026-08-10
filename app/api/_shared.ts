// 라우트 공통 헬퍼.
//
// 유실된 82개 파일 복구 과정에서 신설했다. 라우트마다 trace id 생성과
// no-store 헤더를 반복하던 것을 한 곳으로 모은다 — AGENTS.md 사다리 2번(재사용).
import { identityError } from "../../lib/identity";
import { guardrailResponse } from "../../lib/guardrails";
import { RagError } from "../../lib/rag";

export const newTraceId = () => `trc_${crypto.randomUUID().replaceAll("-", "")}`;

const noStore = (traceId: string) => ({
  "Cache-Control": "no-store",
  "X-Trace-Id": traceId,
});

export function ok(body: unknown, traceId: string, init: ResponseInit = {}) {
  return Response.json(body, {
    ...init,
    headers: { ...noStore(traceId), ...(init.headers as Record<string, string> | undefined) },
  });
}

/**
 * 라우트에서 던져진 오류를 응답으로 바꾼다.
 *
 * AuthError·GuardrailError 는 각 모듈이 사용자에게 보여줄 메시지와 상태 코드를
 * 이미 정해 두었으므로 그대로 쓴다. 그 외에는 내부 사정을 밖으로 흘리지 않기 위해
 * 500 + 일반 메시지로 덮되, trace id 로 로그와 연결할 수 있게 둔다.
 */
export function fail(error: unknown, traceId: string) {
  const known = identityError(error, traceId) ?? guardrailResponse(error, traceId);
  if (known) return known;
  if (error instanceof RagError) {
    return Response.json(
      { error: { code: error.code, message: error.message, trace_id: traceId } },
      { status: error.status, headers: noStore(traceId) },
    );
  }
  console.error(`[${traceId}]`, error);
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "요청을 처리하지 못했습니다.", trace_id: traceId } },
    { status: 500, headers: noStore(traceId) },
  );
}
