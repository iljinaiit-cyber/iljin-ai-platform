import { searchRag } from "../../../../lib/rag";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const url = new URL(request.url);
    const limitParam = Number(url.searchParams.get("limit"));
    const assetIds = url.searchParams.get("asset_ids")?.split(",").map((s) => s.trim()).filter(Boolean);
    const result = await searchRag(url.searchParams.get("q") ?? "", {
      principal,
      traceId,
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
      sourceType: url.searchParams.get("source_type") ?? undefined,
      createdFrom: url.searchParams.get("created_from") ?? undefined,
      createdTo: url.searchParams.get("created_to") ?? undefined,
      assetIds: assetIds?.length ? assetIds : undefined,
    });
    return ok(result, traceId);
  } catch (error) {
    return fail(error, traceId);
  }
}
