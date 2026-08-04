import { getGovernanceDashboard } from "../../../../lib/admin-governance";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    return ok(await getGovernanceDashboard(await resolvePrincipal(request)), traceId);
  } catch (error) { return fail(error, traceId); }
}
