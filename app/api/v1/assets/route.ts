import { ingestDocument, listAssets } from "../../../../lib/rag";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const limit = Number(new URL(request.url).searchParams.get("limit"));
    return ok({ assets: await listAssets(principal, Number.isFinite(limit) && limit > 0 ? limit : undefined) }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const body = await request.json() as {
      title?: string; content?: string; mimeType?: string; sourceType?: string;
      classification?: "public" | "internal" | "confidential";
      departmentScope?: string[]; deduplicate?: boolean;
    };
    // 필드를 명시적으로 옮긴다. 스프레드로 통과시키면 클라이언트가 tenantId·
    // ownerEmail 같은 서버 결정 항목을 덮어쓸 수 있다.
    return ok(await ingestDocument({
      title: body.title ?? "",
      content: body.content ?? "",
      mimeType: body.mimeType,
      sourceType: body.sourceType,
      classification: body.classification,
      departmentScope: body.departmentScope,
      deduplicate: body.deduplicate,
      tenantId: principal.tenantId,
      ownerEmail: principal.email,
    }), traceId, { status: 201 });
  } catch (error) { return fail(error, traceId); }
}
