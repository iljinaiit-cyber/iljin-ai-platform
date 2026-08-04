import { addFeedback } from "../../../../../../lib/conversations";
import { resolvePrincipal } from "../../../../../../lib/identity";
import { fail, newTraceId, ok } from "../../../../_shared";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await ctx.params;
    const body = await request.json() as { rating?: number; comment?: string };
    // 스키마는 -1 | 1 만 받는다. 그 외 값은 addFeedback 이 거부한다.
    return ok(await addFeedback(principal, id, Number(body.rating), body.comment), traceId, { status: 201 });
  } catch (error) { return fail(error, traceId); }
}
