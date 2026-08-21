import { listTools } from "../../../../lib/agent-orchestrator";
import { authorizeFeature } from "../../../../lib/admin-governance";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "agent.run", "agent");
    return ok({ tools: await listTools(principal) }, traceId);
  } catch (error) {
    return fail(error, traceId);
  }
}
