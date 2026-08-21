import { addFeedback } from "../../../../../../lib/conversations";
import { resolvePrincipal } from "../../../../../../lib/identity";
import { recordMessageFeedback } from "../../../../../../lib/user-memory";
import { fail, newTraceId, ok } from "../../../../_shared";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await ctx.params;
    const body = await request.json() as { rating?: number; comment?: string; reason?: string };
    // 스키마는 -1 | 1 만 받는다. 그 외 값은 addFeedback 이 거부한다.
    const rating = Number(body.rating) as 1 | -1;
    const feedbackId = await addFeedback(principal, id, rating, body.comment, body.reason);
    const learningApplied = await recordMessageFeedback(principal, id, rating, body.reason).catch((error) => {
      console.error(`[${traceId}] recordMessageFeedback`, error);
      return false;
    });
    return ok({ id: feedbackId, learning_applied: learningApplied }, traceId, { status: 201 });
  } catch (error) { return fail(error, traceId); }
}
