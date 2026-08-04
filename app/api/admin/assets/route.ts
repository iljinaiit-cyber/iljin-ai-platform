import { listAssets } from "../../../../lib/rag";
import { resolvePrincipal, requireRole } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    requireRole(principal, ["admin", "manager"]);
    const limit = Number(new URL(request.url).searchParams.get("limit"));
    return ok({ assets: await listAssets(principal, Number.isFinite(limit) && limit > 0 ? limit : undefined) }, traceId);
  } catch (error) { return fail(error, traceId); }
}
