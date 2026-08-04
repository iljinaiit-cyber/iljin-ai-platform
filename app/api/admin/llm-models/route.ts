import { getModelConfigs, updateModelConfig } from "../../../../lib/llm-model-config";
import { resolvePrincipal, requireRole } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const p = await resolvePrincipal(request); requireRole(p, ["admin"]);
    return ok({ models: await getModelConfigs(p.tenantId) }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function PATCH(request: Request) {
  const traceId = newTraceId();
  try {
    const p = await resolvePrincipal(request); requireRole(p, ["admin"]);
    const body = await request.json() as Record<string, unknown>;
    return ok(await updateModelConfig({ ...body, principal: p, traceId } as Parameters<typeof updateModelConfig>[0]), traceId);
  } catch (error) { return fail(error, traceId); }
}
