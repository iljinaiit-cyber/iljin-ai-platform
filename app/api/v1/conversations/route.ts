import { createConversation, listConversations } from "../../../../lib/conversations";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const limit = Number(new URL(request.url).searchParams.get("limit"));
    return ok({ conversations: await listConversations(principal, Number.isFinite(limit) && limit > 0 ? limit : undefined) }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const body = await request.json().catch(() => ({})) as { title?: string };
    const conversationId = await createConversation(principal, body.title?.trim() || undefined);
    return ok({ conversation_id: conversationId }, traceId, { status: 201 });
  } catch (error) { return fail(error, traceId); }
}
