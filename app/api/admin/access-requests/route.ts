import { listAccessRequests, resolvePrincipal, reviewAccessRequest } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

// listAccessRequests·reviewAccessRequest 안에서 requireRole(["admin"]) 을 건다.
// 라우트에서 한 번 더 검사하지 않는다 — 권한 규칙이 두 곳에 있으면 갈라진다.
export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    return ok({ requests: await listAccessRequests(principal) }, traceId);
  } catch (error) {
    return fail(error, traceId);
  }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const body = await request.json() as {
      email?: string; decision?: "approved" | "rejected";
      department?: string; corpId?: string | null; deptId?: string | null;
      role?: "user" | "manager"; reason?: string;
    };
    if (body.decision !== "approved" && body.decision !== "rejected") {
      return ok(
        { error: { code: "INVALID_DECISION", message: "decision 은 approved 또는 rejected 여야 합니다.", trace_id: traceId } },
        traceId,
        { status: 400 },
      );
    }
    const user = await reviewAccessRequest({
      principal,
      email: body.email ?? "",
      decision: body.decision,
      department: body.department,
      corpId: body.corpId,
      deptId: body.deptId,
      role: body.role,
      reason: body.reason,
      traceId,
    });
    return ok({ user }, traceId);
  } catch (error) {
    return fail(error, traceId);
  }
}

export const PATCH = POST;
