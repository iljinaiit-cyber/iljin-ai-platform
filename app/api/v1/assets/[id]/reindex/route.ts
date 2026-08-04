import { reindexAsset } from "../../../../../../lib/rag";
import { resolvePrincipal } from "../../../../../../lib/identity";
import { fail, newTraceId, ok } from "../../../../_shared";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const traceId = newTraceId();
  try { const p = await resolvePrincipal(request); const { id } = await ctx.params;
    return ok(await reindexAsset(p, id), traceId, { status: 202 });
  } catch (error) { return fail(error, traceId); }
}
