import { activityCsv, getActivityDashboard } from "../../../../lib/activity";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit"));
    const dashboard = await getActivityDashboard(principal, Number.isFinite(limit) && limit > 0 ? limit : undefined);
    if (url.searchParams.get("format") === "csv") {
      return new Response(activityCsv(dashboard.items), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="activity-${new Date().toISOString().slice(0, 10)}.csv"`,
          "Cache-Control": "no-store",
          "X-Trace-Id": traceId,
        },
      });
    }
    return ok(dashboard, traceId);
  } catch (error) {
    return fail(error, traceId);
  }
}
