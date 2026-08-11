import { sessionCookie, verifyEmailRegistration } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const body = await request.json() as { token?: string };
    const { user, token } = await verifyEmailRegistration({ token: body.token ?? "", traceId });
    return ok({ user }, traceId, { headers: { "Set-Cookie": sessionCookie(token, request) } });
  } catch (error) {
    return fail(error, traceId);
  }
}
