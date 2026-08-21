import { getAssetOriginal } from "../../../../../../lib/rag";
import { resolvePrincipal } from "../../../../../../lib/identity";
import { fail, newTraceId } from "../../../../_shared";
import { audit } from "../../../../../../lib/conversations";

// R2 원본을 그대로 흘려보낸다. JSON 으로 감싸지 않는다.
// getAssetOriginal 이 ACL·크기·ETag 검증까지 끝낸 뒤 { asset, object } 를 돌려준다.
//
// ── 저장형 XSS 차단 (C-3) ────────────────────────────────────────────────
// 종전에는 `Content-Disposition: inline` 으로, 그것도 업로더가 선언한 MIME 을 그대로
// Content-Type 에 실어 되돌려줬다. 허용 목록에 image/svg+xml 이 있으므로 스크립트를
// 심은 SVG 를 올려 링크를 공유하면 열람자 브라우저에서 **앱과 동일 출처로** 실행됐다.
// 세션 쿠키가 HttpOnly 라도 스크립트는 피해자 권한으로 API 를 호출할 수 있다.
//
// 세 겹으로 막는다.
//   1) attachment — 브라우저가 문서로 렌더하지 않고 내려받는다.
//   2) 실행 가능한 형식은 Content-Type 을 중립값으로 강등한다. 업로더 선언값을
//      그대로 신뢰하지 않는다(업로드 시 매직바이트 검증이 없으므로 위장이 가능하다).
//   3) 이 응답에 한해 격리 CSP 를 건다. worker/index.ts 는 라우트가 CSP 를 이미
//      설정한 경우 덮어쓰지 않는다 — 두 변경은 짝이며 한쪽만으로는 무효다.
const SANDBOX_CSP = "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'";

// 브라우저가 문서로 해석해 스크립트를 실행할 수 있는 형식.
const ACTIVE_CONTENT_TYPES = new Set([
  "image/svg+xml", "text/html", "application/xhtml+xml", "text/xml", "application/xml",
  "text/csv", "application/csv", "application/json", "text/plain", "text/markdown",
]);

function safeContentType(declared: string | undefined) {
  const normalized = (declared || "").split(";")[0].trim().toLowerCase();
  if (!normalized) return "application/octet-stream";
  return ACTIVE_CONTENT_TYPES.has(normalized) ? "application/octet-stream" : normalized;
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await ctx.params;
    const { asset, object } = await getAssetOriginal(principal, id);
    await audit({ principal, action: "asset.original.download", resourceType: "asset", resourceId: id, traceId });
    return new Response(object.body, {
      headers: {
        "Content-Type": safeContentType(object.httpMetadata?.contentType || asset.mime_type),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(asset.title || asset.id)}`,
        "Content-Security-Policy": SANDBOX_CSP,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "X-Trace-Id": traceId,
      },
    });
  } catch (error) { return fail(error, traceId); }
}
