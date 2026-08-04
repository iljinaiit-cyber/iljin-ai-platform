import { listTools } from "../../../../lib/agent-orchestrator";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

// MCP Tool 목록 노출 지점. 실행은 /api/v1/agent/runs 를 거친다 —
// 승인·감사 없이 실행되는 경로를 따로 만들지 않는다(05 §5.6 조회/변경 분리).
export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    return ok({ tools: await listTools(principal), execution_endpoint: "/api/v1/agent/runs" }, traceId);
  } catch (error) { return fail(error, traceId); }
}
