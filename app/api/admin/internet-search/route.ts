import { getInternetSearchStatus, probeInternetSearch } from "../../../../lib/internet-search";
import { resolvePrincipal } from "../../../../lib/identity";
import { requirePermission } from "../../../../lib/admin-governance";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await requirePermission(principal, "admin.operations");
    // probe 는 외부 호출이라 비용이 든다. 기본은 상태만 보고, 명시 요청 시에만 두드린다.
    return ok(getInternetSearchStatus(), traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await requirePermission(principal, "admin.operations");
    return ok({ probe: await probeInternetSearch() }, traceId);
  } catch (error) { return fail(error, traceId); }
}
