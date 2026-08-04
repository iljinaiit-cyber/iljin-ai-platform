import { getRuntimeEnv } from "../../../lib/runtime-env";
import { newTraceId, ok } from "../_shared";

// 바인딩 존재 여부만 본다. D1 질의까지 하면 헬스체크가 DB 장애에 물려
// 배포 판정을 막는다 — 여기서는 "Worker 가 떴고 바인딩이 붙었는가"만 답한다.
export async function GET() {
  const traceId = newTraceId();
  const env = getRuntimeEnv();
  return ok(
    {
      status: "ok",
      time: new Date().toISOString(),
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
