import { loginEmailAccount, sessionCookie } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const body = await request.json() as { email?: string; password?: string };
    const { user, token } = await loginEmailAccount(body.email ?? "", body.password ?? "");
    return ok({ user }, traceId, { headers: { "Set-Cookie": sessionCookie(token, request) } });
  } catch (error) {
    return fail(error, traceId);
  }
}
