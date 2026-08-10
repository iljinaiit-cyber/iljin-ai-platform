import { getAssetOriginal } from "../../../../../../lib/rag";
import { resolvePrincipal } from "../../../../../../lib/identity";
import { fail, newTraceId } from "../../../../_shared";
import { audit } from "../../../../../../lib/conversations";

// R2 원본을 그대로 흘려보낸다. JSON 으로 감싸지 않는다 — 브라우저가 직접 연다.
// getAssetOriginal 이 ACL·크기·ETag 검증까지 끝낸 뒤 { asset, object } 를 돌려준다.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await ctx.params;
    const { asset, object } = await getAssetOriginal(principal, id);
    await audit({ principal, action: "asset.original.download", resourceType: "asset", resourceId: id, traceId });
    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType || asset.mime_type || "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.title || asset.id)}`,
        "Cache-Control": "private, no-store",
        "X-Trace-Id": traceId,
      },
    });
  } catch (error) { return fail(error, traceId); }
}
