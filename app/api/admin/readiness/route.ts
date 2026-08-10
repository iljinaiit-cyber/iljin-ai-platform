import { runReadinessProbes } from "../../../../lib/readiness";
import { resolvePrincipal, requireRole } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

// 프로브가 외부(로컬 LLM·Workers AI)를 실제로 두드리므로 관리자만 호출한다.
// 누구나 부르면 헬스체크가 비용·부하 유발 경로가 된다.
export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    requireRole(await resolvePrincipal(request), ["admin"]);
    const readiness = await runReadinessProbes();
    return ok(readiness, traceId, { status: readiness.status === "configuration_required" ? 503 : 200 });
  } catch (error) { return fail(error, traceId); }
}
