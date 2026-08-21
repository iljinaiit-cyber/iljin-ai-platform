import { decideToolApproval } from "../../../../../lib/agent-orchestrator";
import { resolvePrincipal } from "../../../../../lib/identity";
import { authorizeFeature } from "../../../../../lib/admin-governance";
import { fail, newTraceId, ok } from "../../../_shared";

// 자가 승인·권한 검사는 decideToolApproval 안에 있다(manager/admin 만).
// 라우트에서 중복 검사하지 않는다 — 승인 규칙이 두 곳에 있으면 갈라진다.
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "agent.run", "agent");
    const { id } = await ctx.params;
    const body = await request.json() as { decision?: "approved" | "rejected"; note?: string };
    if (body.decision !== "approved" && body.decision !== "rejected") {
      return ok({ error: { code: "INVALID_DECISION", message: "decision 은 approved 또는 rejected 여야 합니다.", trace_id: traceId } }, traceId, { status: 400 });
    }
    return ok(await decideToolApproval({ principal, approvalId: id, decision: body.decision, note: body.note, traceId }), traceId);
  } catch (error) { return fail(error, traceId); }
}
