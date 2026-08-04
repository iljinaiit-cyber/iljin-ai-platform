import { getCitation } from "../../../../lib/rag";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

// 답변 시점 스냅샷이 아니라 지금 권한으로 원본을 다시 조회한다.
// getCitation 이 tenant·department 로 재검증하므로 권한이 회수됐으면 여기서 막힌다.
export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const url = new URL(request.url);
    const assetId = url.searchParams.get("asset_id") ?? "";
    const segmentId = url.searchParams.get("segment_id") ?? "";
    if (!assetId || !segmentId) {
      return ok({ error: { code: "INVALID_QUERY", message: "asset_id 와 segment_id 가 필요합니다.", trace_id: traceId } }, traceId, { status: 400 });
    }
    return ok(await getCitation(assetId, segmentId, principal), traceId);
  } catch (error) {
    return fail(error, traceId);
  }
}
