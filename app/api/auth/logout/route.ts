import { expiredSessionCookie, signOutEmailSession } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    // 세션이 이미 없어도 성공으로 끝낸다. 로그아웃은 멱등해야 한다.
    await signOutEmailSession(request);
    return ok({ ok: true }, traceId, { headers: { "Set-Cookie": expiredSessionCookie(request) } });
  } catch (error) {
    return fail(error, traceId);
  }
}
