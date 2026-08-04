import { getInternetSearchStatus, probeInternetSearch } from "../../../../lib/internet-search";
import { resolvePrincipal, requireRole } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    requireRole(await resolvePrincipal(request), ["admin"]);
    // probe 는 외부 호출이라 비용이 든다. 기본은 상태만 보고, 명시 요청 시에만 두드린다.
    const probe = new URL(request.url).searchParams.get("probe") === "1";
    return ok({ status: getInternetSearchStatus(), probe: probe ? await probeInternetSearch() : null }, traceId);
  } catch (error) { return fail(error, traceId); }
}
