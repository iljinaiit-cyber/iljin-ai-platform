import { toggleFeedbackLike } from "../../../../../../lib/feedback-board";
import { enforceRateLimit } from "../../../../../../lib/guardrails";
import { resolvePrincipal } from "../../../../../../lib/identity";
import { fail, newTraceId, ok } from "../../../../_shared";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await enforceRateLimit(principal, "feedback.like", 60);
    const { id } = await ctx.params;
    return ok(await toggleFeedbackLike(principal, id), traceId);
  } catch (error) {
    return fail(error, traceId);
  }
}
