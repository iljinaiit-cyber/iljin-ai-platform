import { createIngestionSource, deleteIngestionSource, listIngestionSources, updateIngestionSource } from "../../../../lib/rag";
import { resolvePrincipal, requireRole } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const p = await resolvePrincipal(request); requireRole(p, ["admin"]);
    return ok({ sources: await listIngestionSources(p.tenantId) }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const p = await resolvePrincipal(request); requireRole(p, ["admin"]);
    const body = await request.json() as Record<string, unknown>;
    return ok(await createIngestionSource({ ...body, tenantId: p.tenantId } as Parameters<typeof createIngestionSource>[0]), traceId, { status: 201 });
  } catch (error) { return fail(error, traceId); }
}

export async function PATCH(request: Request) {
  const traceId = newTraceId();
  try {
    const p = await resolvePrincipal(request); requireRole(p, ["admin"]);
    const { id, ...fields } = await request.json() as { id?: string } & Record<string, unknown>;
    if (!id) return ok({ error: { code: "INVALID_INPUT", message: "id 가 필요합니다.", trace_id: traceId } }, traceId, { status: 400 });
    return ok(await updateIngestionSource(p.tenantId, id, fields as Parameters<typeof updateIngestionSource>[2]), traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function DELETE(request: Request) {
  const traceId = newTraceId();
  try {
    const p = await resolvePrincipal(request); requireRole(p, ["admin"]);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) return ok({ error: { code: "INVALID_INPUT", message: "id 가 필요합니다.", trace_id: traceId } }, traceId, { status: 400 });
    await deleteIngestionSource(p.tenantId, id);
    return ok({ ok: true }, traceId);
  } catch (error) { return fail(error, traceId); }
}
