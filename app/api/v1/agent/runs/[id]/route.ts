import { getAgentRun } from "../../../../../../lib/agent-orchestrator";
import { resolvePrincipal } from "../../../../../../lib/identity";
import { fail, newTraceId, ok } from "../../../../_shared";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await ctx.params;
    return ok(await getAgentRun(principal, id), traceId);
  } catch (error) { return fail(error, traceId); }
}
