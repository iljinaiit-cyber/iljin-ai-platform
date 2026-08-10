import {
  createScheduleWorkItem,
  deleteScheduleWorkItem,
  listScheduleAlerts,
  listScheduleWorkItems,
  updateScheduleWorkItem,
  type ScheduleWorkItemKind,
  type ScheduleWorkItemPriority,
  type ScheduleWorkItemStatus,
} from "../../../../lib/schedule-planning";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

const kinds = new Set<ScheduleWorkItemKind>(["todo", "milestone", "reminder", "execution"]);
const priorities = new Set<ScheduleWorkItemPriority>(["low", "normal", "high", "urgent"]);
const statuses = new Set<ScheduleWorkItemStatus>(["open", "in_progress", "done", "failed", "cancelled"]);

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const status = new URL(request.url).searchParams.get("status") as ScheduleWorkItemStatus | "all" | null;
    const requestedStatus = status && status !== "all" && statuses.has(status) ? status : "all";
    return ok({ items: await listScheduleWorkItems(principal, { status: requestedStatus }), notifications: await listScheduleAlerts(principal) }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const body = await request.json() as {
      title?: string; description?: string; kind?: ScheduleWorkItemKind; priority?: ScheduleWorkItemPriority;
      due_at?: string | null; notify_enabled?: boolean;
    };
    if (!body.title?.trim() || body.title.trim().length > 240 || (body.kind && !kinds.has(body.kind)) || (body.priority && !priorities.has(body.priority))) {
      return ok({ error: { code: "INVALID_INPUT", message: "title, kind, priority를 확인해 주세요.", trace_id: traceId } }, traceId, { status: 400 });
    }
    const id = await createScheduleWorkItem({
      principal,
      title: body.title,
      description: body.description,
      kind: body.kind,
      priority: body.priority,
      dueAt: body.due_at,
      notifyEnabled: body.notify_enabled !== false,
    });
    return ok({ id }, traceId, { status: 201 });
  } catch (error) { return fail(error, traceId); }
}

export async function PATCH(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const body = await request.json() as {
      id?: string; title?: string; description?: string; status?: ScheduleWorkItemStatus;
      priority?: ScheduleWorkItemPriority; due_at?: string | null; notify_enabled?: boolean;
    };
    if (!body.id || (body.status && !statuses.has(body.status)) || (body.priority && !priorities.has(body.priority))) {
      return ok({ error: { code: "INVALID_INPUT", message: "id와 변경 값을 확인해 주세요.", trace_id: traceId } }, traceId, { status: 400 });
    }
    await updateScheduleWorkItem(principal, body.id, {
      title: body.title, description: body.description, status: body.status, priority: body.priority,
      dueAt: body.due_at, notifyEnabled: body.notify_enabled,
    });
    return ok({ ok: true }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function DELETE(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!id) return ok({ error: { code: "INVALID_INPUT", message: "id가 필요합니다.", trace_id: traceId } }, traceId, { status: 400 });
    await deleteScheduleWorkItem(principal, id);
    return ok({ ok: true }, traceId);
  } catch (error) { return fail(error, traceId); }
}
