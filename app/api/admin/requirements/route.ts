import { DEVELOPMENT_REQUIREMENTS, OUTSTANDING_DEVELOPMENT_REQUIREMENTS, requirementSummary } from "../../../../lib/requirements-registry";
import { resolvePrincipal } from "../../../../lib/identity";
import { requirePermission } from "../../../../lib/admin-governance";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await requirePermission(principal, "admin.operations");
    return ok({
      requirements: DEVELOPMENT_REQUIREMENTS,
      items: OUTSTANDING_DEVELOPMENT_REQUIREMENTS,
      outstanding: OUTSTANDING_DEVELOPMENT_REQUIREMENTS,
      summary: requirementSummary(),
    }, traceId);
  } catch (error) { return fail(error, traceId); }
}
