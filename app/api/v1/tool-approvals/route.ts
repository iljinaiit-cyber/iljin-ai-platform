import { listToolApprovals } from "../../../../lib/agent-orchestrator";
import { resolvePrincipal } from "../../../../lib/identity";
import { authorizeFeature } from "../../../../lib/admin-governance";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "agent.run", "agent");
    const limit = Number(new URL(request.url).searchParams.get("limit"));
    return ok({ approvals: await listToolApprovals(principal, Number.isFinite(limit) && limit > 0 ? limit : undefined) }, traceId);
  } catch (error) { return fail(error, traceId); }
}
