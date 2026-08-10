import { approveUserMemory, deleteUserMemory, rejectUserMemory } from "../../../../../lib/user-memory";
import { resolvePrincipal } from "../../../../../lib/identity";
import { audit } from "../../../../../lib/conversations";
import { fail, newTraceId, ok } from "../../../_shared";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, ctx: Ctx) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await ctx.params;
    await deleteUserMemory(principal, id);
    await audit({ principal, action: "memory.delete", resourceType: "user_memory", resourceId: id, traceId });
    return ok({ ok: true }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function PATCH(request: Request, ctx: Ctx) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({})) as { action?: string };
    if (body.action === "approve") await approveUserMemory(principal, id);
    else if (body.action === "reject") await rejectUserMemory(principal, id);
    else return new Response(JSON.stringify({ error: { message: "지원하지 않는 메모리 작업입니다." }, trace_id: traceId }), { status: 400, headers: { "Content-Type": "application/json" } });
    await audit({ principal, action: body.action === "approve" ? "memory.approve" : "memory.reject", resourceType: "user_memory", resourceId: id, traceId });
    return ok({ ok: true }, traceId);
  } catch (error) { return fail(error, traceId); }
}
