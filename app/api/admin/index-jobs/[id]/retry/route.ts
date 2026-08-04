import { retryIndexJob } from "../../../../../../lib/rag";
import { resolvePrincipal, requireRole } from "../../../../../../lib/identity";
import { fail, newTraceId, ok } from "../../../../_shared";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    requireRole(principal, ["admin", "manager"]);
    const { id } = await ctx.params;
    return ok(await retryIndexJob(principal, id), traceId, { status: 202 });
  } catch (error) { return fail(error, traceId); }
}
