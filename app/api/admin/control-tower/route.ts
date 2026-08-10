import { getControlTower, updateControlAssessment, updateSloPolicy } from "../../../../lib/control-tower";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    return ok(await getControlTower(await resolvePrincipal(request)), traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "assessment") {
      await updateControlAssessment({
        principal,
        controlId: String(body.controlId ?? ""),
        status: body.status as Parameters<typeof updateControlAssessment>[0]["status"],
        ownerEmail: String(body.ownerEmail ?? ""),
        evidenceNote: String(body.evidenceNote ?? ""),
        dueDate: String(body.dueDate ?? ""),
        traceId,
      });
    } else if (body.action === "slo") {
      await updateSloPolicy({
        principal,
        metricKey: String(body.metricKey ?? ""),
        target: Number(body.target),
        enabled: body.enabled === true,
        traceId,
      });
    } else {
      return ok({ error: { code: "INVALID_ACTION", message: "지원하지 않는 변경 요청입니다." } }, traceId, { status: 400 });
    }
    return ok({ updated: true }, traceId);
  } catch (error) { return fail(error, traceId); }
}
