import { createFeedbackComment } from "../../../../../../lib/feedback-board";
import { enforceRateLimit } from "../../../../../../lib/guardrails";
import { resolvePrincipal } from "../../../../../../lib/identity";
import { fail, newTraceId, ok } from "../../../../_shared";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await enforceRateLimit(principal, "feedback.comment", 20);
    const { id } = await ctx.params;
    const body = await request.json() as { content?: unknown };
    return ok({ item: await createFeedbackComment(principal, id, body.content) }, traceId, { status: 201 });
  } catch (error) {
    return fail(error, traceId);
  }
}
