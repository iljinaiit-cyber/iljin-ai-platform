import { createIngestionSource } from "../../../../../lib/rag";
import { resolvePrincipal } from "../../../../../lib/identity";
import { authorizeFeature } from "../../../../../lib/admin-governance";
import { fail, newTraceId, ok } from "../../../_shared";

const CONNECTOR_TYPES = new Set(["pc-folder", "network-folder", "local-db"]);

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "documents.manage", "documents.upload");
    const body = await request.json() as Record<string, unknown>;
    const sourceType = typeof body.source_type === "string" ? body.source_type : "";
    if (!CONNECTOR_TYPES.has(sourceType)) return ok({ error: { code: "INVALID_CONNECTOR_TYPE", message: "지원하지 않는 로컬 연결 유형입니다.", trace_id: traceId } }, traceId, { status: 400 });
    const sourceId = await createIngestionSource({
      tenantId: principal.tenantId,
      name: typeof body.name === "string" ? body.name : "로컬 문서 연결",
      source_type: sourceType as "pc-folder" | "network-folder" | "local-db",
      connection_config: body.connection_config && typeof body.connection_config === "object" ? body.connection_config as Record<string, unknown> : {},
      schedule_interval_minutes: Number.isInteger(body.schedule_interval_minutes) ? Number(body.schedule_interval_minutes) : 5,
      classification: typeof body.classification === "string" ? body.classification : "internal",
      department_scope: typeof body.department_scope === "string" ? body.department_scope : "*",
      created_by: principal.email,
    });
    return ok({ sourceId, message: "로컬 연결을 등록했습니다. 자동 수집 후 임베딩됩니다." }, traceId, { status: 201 });
  } catch (error) { return fail(error, traceId); }
}
