import { resolvePrincipal } from "../../../../lib/identity";
import { requirePermission } from "../../../../lib/admin-governance";
import { graphRelatedSegments, neighbors, ontologyStats, resolveQueryEntities } from "../../../../lib/ontology";
import { fail, newTraceId, ok } from "../../_shared";

/**
 * 온톨로지 현황과 그래프 탐색.
 *   GET /api/admin/ontology            → 통계
 *   GET /api/admin/ontology?q=KS D 3698 → 질의 엔티티 + 이웃 + 관련 세그먼트
 */
export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await requirePermission(principal, "admin.operations");
    const query = new URL(request.url).searchParams.get("q")?.trim();

    const stats = await ontologyStats(principal.tenantId);
    if (!query) return ok({ stats }, traceId);

    const seeds = await resolveQueryEntities(principal.tenantId, query);
    const [related, graph] = await Promise.all([
      seeds.length
        ? neighbors({ tenantId: principal.tenantId, entityIds: seeds.map((s) => s.id), maxHops: 2, limit: 40 })
        : Promise.resolve([]),
      graphRelatedSegments({ tenantId: principal.tenantId, query, limit: 20 }),
    ]);
    return ok({ stats, query, seeds, neighbors: related, segments: graph.segments }, traceId);
  } catch (error) { return fail(error, traceId); }
}
