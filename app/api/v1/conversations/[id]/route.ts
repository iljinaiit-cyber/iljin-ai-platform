import { deleteConversation, getConversation } from "../../../../../lib/conversations";
import { resolvePrincipal } from "../../../../../lib/identity";
import { cleanupConversationAttachments } from "../../../../../lib/conversation-attachments";
import { fail, newTraceId, ok } from "../../../_shared";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await ctx.params;
    return ok(await getConversation(principal, id), traceId);
  } catch (error) { return fail(error, traceId); }
}

// 논리 삭제다(status='deleted'). 물리 삭제가 아니므로 감사 이력은 남는다.
export async function DELETE(request: Request, ctx: Ctx) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await ctx.params;
    await cleanupConversationAttachments(principal, id);
    await deleteConversation(principal, id);
    return ok({ ok: true }, traceId);
  } catch (error) { return fail(error, traceId); }
}
