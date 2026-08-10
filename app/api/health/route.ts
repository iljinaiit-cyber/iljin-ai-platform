import { getRuntimeEnv } from "../../../lib/runtime-env";
import { getGatewayStatus } from "../../../lib/llm-gateway";
import { getRagStatus } from "../../../lib/rag";
import { newTraceId, ok } from "../_shared";

// 바인딩 존재 여부만 본다. D1 질의까지 하면 헬스체크가 DB 장애에 물려
// 배포 판정을 막는다 — 여기서는 "Worker 가 떴고 바인딩이 붙었는가"만 답한다.
export async function GET() {
  const traceId = newTraceId();
  const env = getRuntimeEnv();
  const gateway = getGatewayStatus();
  const rag = getRagStatus();
  return ok(
    {
      status:
        gateway.configured && rag.d1Configured && rag.r2Configured
          ? "ready"
          : "configuration_required",
      time: new Date().toISOString(),
      gateway,
      llmRouting: {
        primary: "cloudflare",
        fallback: "local",
        sequence: gateway.sequence,
        primaryConfigured: gateway.primaryConfigured,
        secondaryConfigured: gateway.secondaryConfigured,
        fallbackConfigured: gateway.fallbackConfigured,
      },
      rag,
      bindings: {
        db: Boolean(env.DB),
        bucket: Boolean(env.BUCKET),
        vector_index: Boolean(env.VECTOR_INDEX),
        ai: Boolean(env.AI),
        index_queue: Boolean(env.INDEX_QUEUE),
      },
    },
    traceId,
  );
}
