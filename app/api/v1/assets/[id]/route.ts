import { deleteAsset, getAsset, updateAssetMetadata } from "../../../../../lib/rag";
import { resolvePrincipal } from "../../../../../lib/identity";
import { fail, newTraceId, ok } from "../../../_shared";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const traceId = newTraceId();
  try { const p = await resolvePrincipal(request); const { id } = await ctx.params;
    return ok(await getAsset(p, id), traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function PATCH(request: Request, ctx: Ctx) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request); const { id } = await ctx.params;
    const body = await request.json() as Record<string, unknown>;
    return ok(await updateAssetMetadata({ ...body, principal, assetId: id, traceId } as Parameters<typeof updateAssetMetadata>[0]), traceId);
  } catch (error) { return fail(error, traceId); }
}

// 파생 데이터(segment·embedding·visual_region)까지 연쇄 삭제된다 — deleteAsset 이 담당.
export async function DELETE(request: Request, ctx: Ctx) {
  const traceId = newTraceId();
  try { const p = await resolvePrincipal(request); const { id } = await ctx.params;
    await deleteAsset(p, id); return ok({ ok: true }, traceId);
  } catch (error) { return fail(error, traceId); }
}
