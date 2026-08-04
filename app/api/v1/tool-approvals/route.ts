import { listToolApprovals } from "../../../../lib/agent-orchestrator";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const limit = Number(new URL(request.url).searchParams.get("limit"));
    return ok({ approvals: await listToolApprovals(principal, Number.isFinite(limit) && limit > 0 ? limit : undefined) }, traceId);
  } catch (error) { return fail(error, traceId); }
}
