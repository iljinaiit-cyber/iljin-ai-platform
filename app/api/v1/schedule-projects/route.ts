import { createScheduleProject, deleteScheduleProject, listScheduleProjects, updateScheduleProject, type ScheduleProjectStatus } from "../../../../lib/schedule-planning";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

const statuses = new Set<ScheduleProjectStatus>(["active", "on_hold", "completed"]);
const invalid = (traceId: string, message: string) => ok({ error: { code: "INVALID_INPUT", message, trace_id: traceId } }, traceId, { status: 400 });

export async function GET(request: Request) {
  const traceId = newTraceId();
  try { return ok({ items: await listScheduleProjects(await resolvePrincipal(request)) }, traceId); }
  catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const body = await request.json() as { title?: string; description?: string; color?: string };
    if (typeof body.title !== "string" || body.title.trim().length < 2 || body.title.trim().length > 120) return invalid(traceId, "프로젝트 이름은 2~120자로 입력해 주세요.");
    if (body.description !== undefined && typeof body.description !== "string") return invalid(traceId, "프로젝트 설명 형식이 올바르지 않습니다.");
    if (body.color !== undefined && (typeof body.color !== "string" || body.color.length > 32)) return invalid(traceId, "프로젝트 색상 형식이 올바르지 않습니다.");
    return ok({ id: await createScheduleProject({ principal: await resolvePrincipal(request), title: body.title, description: body.description, color: body.color }) }, traceId, { status: 201 });
  } catch (error) { return fail(error, traceId); }
}

export async function PATCH(request: Request) {
  const traceId = newTraceId();
  try {
    const body = await request.json() as { id?: string; title?: string; description?: string; status?: ScheduleProjectStatus; color?: string };
    if (typeof body.id !== "string" || !body.id) return invalid(traceId, "프로젝트 ID가 필요합니다.");
    if (body.title !== undefined && (typeof body.title !== "string" || body.title.trim().length < 2 || body.title.trim().length > 120)) return invalid(traceId, "프로젝트 이름은 2~120자로 입력해 주세요.");
    if (body.description !== undefined && typeof body.description !== "string") return invalid(traceId, "프로젝트 설명 형식이 올바르지 않습니다.");
    if (body.status !== undefined && !statuses.has(body.status)) return invalid(traceId, "프로젝트 상태가 올바르지 않습니다.");
    if (body.color !== undefined && (typeof body.color !== "string" || body.color.length > 32)) return invalid(traceId, "프로젝트 색상 형식이 올바르지 않습니다.");
    await updateScheduleProject(await resolvePrincipal(request), body.id, body);
    return ok({ ok: true }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function DELETE(request: Request) {
  const traceId = newTraceId();
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return invalid(traceId, "프로젝트 ID가 필요합니다.");
    await deleteScheduleProject(await resolvePrincipal(request), id);
    return ok({ ok: true }, traceId);
  } catch (error) { return fail(error, traceId); }
}
