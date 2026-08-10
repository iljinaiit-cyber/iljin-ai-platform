import { searchInternet } from "../../../../lib/internet-search";
import { resolvePrincipal } from "../../../../lib/identity";
import { authorizeFeature } from "../../../../lib/admin-governance";
import { enforceRateLimit } from "../../../../lib/guardrails";
import { fail, newTraceId, ok } from "../../_shared";

// 공개 웹 검색이다. 사내 근거와 섞이지 않도록 프런트가 scope 를 분리해 호출한다.
async function runSearch(request: Request, traceId: string, query: string, rawLimit: unknown) {
  const principal = await resolvePrincipal(request);
  await authorizeFeature(principal, "rag.search", "rag.search");
  await enforceRateLimit(principal, "internet-search", 30);
  const limit = Number(rawLimit);
  return ok(await searchInternet(query, {
    principal, traceId, limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
  } as Parameters<typeof searchInternet>[1]), traceId);
}

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const url = new URL(request.url);
    return await runSearch(request, traceId, url.searchParams.get("q") ?? "", url.searchParams.get("limit"));
  } catch (error) { return fail(error, traceId); }
}

// 검색 화면(외부 참고자료 탭)은 필터를 함께 보낼 여지가 있어 JSON 본문으로 POST 한다.
export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const body = await request.json().catch(() => ({})) as { query?: string; limit?: number };
    return await runSearch(request, traceId, body.query ?? "", body.limit);
  } catch (error) { return fail(error, traceId); }
}
