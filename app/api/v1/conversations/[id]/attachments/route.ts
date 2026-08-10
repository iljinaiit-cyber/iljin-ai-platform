import { attachConversationAsset, listConversationAttachments } from "../../../../../../lib/conversations";
import { resolvePrincipal } from "../../../../../../lib/identity";
import { cleanupConversationAttachments } from "../../../../../../lib/conversation-attachments";
import { fail, newTraceId, ok } from "../../../../_shared";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await ctx.params;
    const items = await listConversationAttachments(principal, id);
    // Keep the legacy field for API consumers while matching the portal's list
    // contract. Without `items`, successful uploads were invisible in the chat.
    return ok({ items, attachments: items }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request, ctx: Ctx) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await ctx.params;
    const body = await request.json() as { asset_id?: string; assetId?: string };
    const assetId = body.asset_id ?? body.assetId ?? "";
    if (!assetId) return ok({ error: { code: "INVALID_INPUT", message: "asset_id 가 필요합니다.", trace_id: traceId } }, traceId, { status: 400 });
    await attachConversationAsset(principal, id, assetId);
    return ok({ ok: true }, traceId, { status: 201 });
  } catch (error) { return fail(error, traceId); }
}

export async function DELETE(request: Request, ctx: Ctx) {
  const traceId = newTraceId();
  try {
    // 소유권 확인 목적으로 호출한다. 실패하면 여기서 예외가 난다.
    const principal = await resolvePrincipal(request);
    const { id } = await ctx.params;
    await cleanupConversationAttachments(principal, id);
    return ok({ ok: true }, traceId);
  } catch (error) { return fail(error, traceId); }
}
