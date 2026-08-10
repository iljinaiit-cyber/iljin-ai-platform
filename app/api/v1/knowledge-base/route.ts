import { listAssets } from "../../../../lib/rag";
import { resolvePrincipal } from "../../../../lib/identity";
import { authorizeFeature } from "../../../../lib/admin-governance";
import { fail, newTraceId, ok } from "../../_shared";

const SOURCE_LABELS: Record<string, string> = {
  upload: "직접 업로드", sharepoint: "SharePoint", confluence: "Confluence",
  web: "웹 수집", email: "메일", erp: "ERP", mes: "MES",
};

// 프런트 KnowledgeOverview 계약(app/AgentPortal.tsx)에 맞춘 집계다.
// 별도 집계 쿼리를 새로 만들지 않고 listAssets 결과를 접는다 — 문서 수가
// 수천 건을 넘어가면 D1 집계 쿼리로 옮겨야 한다.
// ponytail: 앱 레벨 집계, 상한 listAssets(limit). 확장 시 SQL GROUP BY 로 이관.
export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "rag.search", "rag.search");
    const items = await listAssets(principal, 100);
    const counts = new Map<string, number>();
    const statusCounts = new Map<string, number>();
    const embeddingModels = new Map<string, number>();
    let totalSegments = 0;
    let totalBytes = 0;
    let vectorReadyDocuments = 0;
    let latestUpdatedAt: string | undefined;
    for (const a of items) {
      const src = a.source_type || "upload";
      counts.set(src, (counts.get(src) ?? 0) + 1);
      statusCounts.set(a.status, (statusCounts.get(a.status) ?? 0) + 1);
      if (a.embedding_model && a.embedding_dimensions) {
        vectorReadyDocuments += 1;
        embeddingModels.set(a.embedding_model, (embeddingModels.get(a.embedding_model) ?? 0) + 1);
      }
      totalSegments += Number(a.segment_count || 0);
      totalBytes += Number(a.original_size || 0);
      const updated = a.updated_at || "";
      if (updated && (!latestUpdatedAt || updated > latestUpdatedAt)) latestUpdatedAt = updated;
    }
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const recentUpdates = items.filter((a) => a.updated_at >= since).slice(0, 12);
    const indexedDocuments = statusCounts.get("indexed") ?? 0;
    const embeddingModel = [...embeddingModels].sort((left, right) => right[1] - left[1])[0]?.[0];
    const embeddingDimensions = items.find((item) => item.embedding_model === embeddingModel)?.embedding_dimensions;
    return ok({
      items,
      recent: recentUpdates,
      categories: [...counts].map(([sourceType, count]) => ({ sourceType, label: SOURCE_LABELS[sourceType] ?? sourceType, count })),
      summary: {
        totalDocuments: items.length,
        indexedDocuments,
        processingDocuments: (statusCounts.get("queued") ?? 0) + (statusCounts.get("indexing") ?? 0) + (statusCounts.get("processing") ?? 0),
        failedDocuments: statusCounts.get("failed") ?? 0,
        totalSegments,
        recentUpdates: recentUpdates.length,
        sourceCount: counts.size,
        totalBytes,
        vectorCoverage: items.length ? Math.round((vectorReadyDocuments / items.length) * 100) : 0,
        embeddingModel,
        embeddingDimensions,
        latestUpdatedAt,
        department: principal.department,
      },
    }, traceId);
  } catch (error) { return fail(error, traceId); }
}
