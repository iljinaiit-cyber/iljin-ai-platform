import { DEVELOPMENT_REQUIREMENTS, OUTSTANDING_DEVELOPMENT_REQUIREMENTS, requirementSummary } from "../../../../lib/requirements-registry";
import { resolvePrincipal, requireRole } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    requireRole(await resolvePrincipal(request), ["admin"]);
    return ok({
      requirements: DEVELOPMENT_REQUIREMENTS,
      outstanding: OUTSTANDING_DEVELOPMENT_REQUIREMENTS,
      summary: requirementSummary(),
    }, traceId);
  } catch (error) { return fail(error, traceId); }
}
