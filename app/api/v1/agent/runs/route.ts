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
    const body = await request.json() as { objective?: string; tool_id?: string; tool_input?: Record<string, unknown> };
    return ok(await createAgentRun({
      principal,
      objective: body.objective ?? "",
      toolId: body.tool_id,
      toolInput: body.tool_input,
      idempotencyKey: request.headers.get("Idempotency-Key") ?? "",
      traceId,
    }), traceId, { status: 201 });
  } catch (error) { return fail(error, traceId); }
}
