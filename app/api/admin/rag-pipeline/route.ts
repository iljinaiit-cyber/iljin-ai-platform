import { getRagStatus, probeRagPipeline } from "../../../../lib/rag";
import { resolvePrincipal, requireRole } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    requireRole(await resolvePrincipal(request), ["admin"]);
    const component = new URL(request.url).searchParams.get("component");
    return ok({
      status: getRagStatus(),
      probe: component ? await probeRagPipeline(component as Parameters<typeof probeRagPipeline>[0]) : null,
    }, traceId);
  } catch (error) { return fail(error, traceId); }
}
