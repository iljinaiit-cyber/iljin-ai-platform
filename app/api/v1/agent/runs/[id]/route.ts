import { getAgentRun } from "../../../../../../lib/agent-orchestrator";
import { resolvePrincipal } from "../../../../../../lib/identity";
import { authorizeFeature } from "../../../../../../lib/admin-governance";
import { fail, newTraceId, ok } from "../../../../_shared";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "agent.run", "agent");
    const { id } = await ctx.params;
    return ok(await getAgentRun(principal, id), traceId);
  } catch (error) { return fail(error, traceId); }
}
