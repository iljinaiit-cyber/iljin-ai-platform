import { updateFeedbackPost, updateFeedbackStatus } from "../../../../../lib/feedback-board";
import { resolvePrincipal } from "../../../../../lib/identity";
import { fail, newTraceId, ok } from "../../../_shared";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await ctx.params;
    const body = await request.json() as { status?: unknown; title?: unknown; content?: unknown; category?: unknown; isNotice?: unknown };
    if (body.status !== undefined) {
      return ok(await updateFeedbackStatus(principal, id, body.status), traceId);
    }
    return ok({ item: await updateFeedbackPost(principal, id, body) }, traceId);
  } catch (error) {
    return fail(error, traceId);
  }
}
