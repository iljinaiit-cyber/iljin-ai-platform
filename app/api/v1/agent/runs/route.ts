import { createAgentRun, listAgentRuns } from "../../../../../lib/agent-orchestrator";
import { resolvePrincipal } from "../../../../../lib/identity";
import { authorizeFeature } from "../../../../../lib/admin-governance";
import { fail, newTraceId, ok } from "../../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "agent.run", "agent");
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit"));
    return ok({ runs: await listAgentRuns(principal, {
      tenantScope: url.searchParams.get("scope") === "tenant",
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    }) }, traceId);
  } catch (error) { return fail(error, traceId); }
}

// Idempotency-Key 는 헤더가 정본이다(06 §6.5). 없으면 createAgentRun 이 400 을 낸다 —
// 여기서 임의로 만들어 주면 재시도가 중복 실행된다.
export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "agent.run", "agent");
    const body = await request.json() as { objective?: string; tool_id?: string; tool_input?: Record<string, unknown>; agent_id?: string; project_id?: string; parent_id?: string };
    const result = await createAgentRun({
      principal,
      objective: body.objective ?? "",
      toolId: body.tool_id,
      toolInput: body.tool_input,
      agentId: body.agent_id,
      projectId: body.project_id,
      parentId: body.parent_id,
      idempotencyKey: request.headers.get("Idempotency-Key") ?? "",
      traceId,
    });
    return ok(result, traceId, {
      status: result.reused ? 200 : result.run.status === "awaiting_approval" ? 202 : 201,
      headers: result.reused ? { "Idempotency-Replayed": "true" } : undefined,
    });
  } catch (error) { return fail(error, traceId); }
}
