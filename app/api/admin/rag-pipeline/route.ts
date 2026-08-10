import { getRagStatus, probeRagPipeline } from "../../../../lib/rag";
import { resolvePrincipal } from "../../../../lib/identity";
import { requirePermission } from "../../../../lib/admin-governance";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await requirePermission(principal, "admin.operations");
    const component = new URL(request.url).searchParams.get("component");
    return ok({
      status: getRagStatus(),
      components: [
        { id: "r2", name: "Object Storage" },
        { id: "embedding", name: "Cloudflare Embedding" },
        { id: "vector", name: "Vector DB" },
        { id: "reranker", name: "Cloudflare Reranker" },
      ],
      probe: component ? await probeRagPipeline(component as Parameters<typeof probeRagPipeline>[0]) : null,
    }, traceId);
  } catch (error) { return fail(error, traceId); }
}
