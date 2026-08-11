import { registerEmailAccount } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const body = await request.json() as {
      email?: string; password?: string; displayName?: string;
      department?: string; note?: string; adminCode?: string;
    };
    // 신뢰 경계다. 빈 값은 registerEmailAccount 가 AuthError 로 되돌려 준다.
    const result = await registerEmailAccount({
      email: body.email ?? "",
      password: body.password ?? "",
      displayName: body.displayName ?? "",
      department: body.department ?? "",
      note: body.note,
      adminCode: body.adminCode,
      verificationUrl: new URL("/verify-email", request.url).toString(),
      traceId,
    });
    return ok(result, traceId, { status: 202 });
  } catch (error) {
    return fail(error, traceId);
  }
}
