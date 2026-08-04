import { submitAccessApplication } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

// submitAccessApplication 이 request 로부터 identity 를 직접 해석한다.
// 여기서 미리 풀어 넘기지 않는다 — 중복 해석은 세션 갱신을 두 번 돌린다.
export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const body = await request.json() as { department?: string; note?: string };
    const user = await submitAccessApplication({
      request,
      department: body.department ?? "",
      note: body.note,
      traceId,
    });
    return ok({ user }, traceId);
  } catch (error) {
    return fail(error, traceId);
  }
}
