import { resolveAccessIdentity, updateOwnProfile } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

// 승인 대기·거절 상태도 200 으로 돌려준다(openapi 명시). 업무 API 접근 차단은
// 각 라우트의 requireRole/승인 검사가 따로 담당한다 — 여기서 막으면
// 프런트가 "왜 막혔는지" 화면을 그릴 수 없다.
export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    return ok({ user: await resolveAccessIdentity(request) }, traceId);
  } catch (error) {
    return fail(error, traceId);
  }
}

export async function PATCH(request: Request) {
  const traceId = newTraceId();
  try {
    const body = await request.json() as { displayName?: string; department?: string };
    const user = await updateOwnProfile({
      request,
      displayName: body.displayName ?? "",
      department: body.department ?? "",
      traceId,
    });
    return ok({ user }, traceId);
  } catch (error) {
    return fail(error, traceId);
  }
}
