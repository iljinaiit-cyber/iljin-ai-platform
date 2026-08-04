import { searchInternet } from "../../../../lib/internet-search";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

// 공개 웹 검색이다. 사내 근거와 섞이지 않도록 프런트가 scope 를 분리해 호출한다.
export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit"));
    return ok(await searchInternet(url.searchParams.get("q") ?? "", {
      principal, traceId, limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    } as Parameters<typeof searchInternet>[1]), traceId);
  } catch (error) { return fail(error, traceId); }
}
