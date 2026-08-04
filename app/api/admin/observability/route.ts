import { getModelConfigDashboard } from "../../../../lib/llm-model-config";
import { listProviderProbes } from "../../../../lib/provider-resources";
import { resolvePrincipal, requireRole } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const p = await resolvePrincipal(request); requireRole(p, ["admin"]);
    return ok({ models: await getModelConfigDashboard(p), probes: await listProviderProbes(p.tenantId) }, traceId);
  } catch (error) { return fail(error, traceId); }
}
