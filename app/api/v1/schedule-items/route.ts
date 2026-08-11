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

function invalid(traceId: string, message: string) {
  return ok({ error: { code: "INVALID_INPUT", message, trace_id: traceId } }, traceId, { status: 400 });
}

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const status = new URL(request.url).searchParams.get("status") as ScheduleWorkItemStatus | "all" | null;
    if (status && status !== "all" && !statuses.has(status)) return invalid(traceId, "업무 상태 필터가 올바르지 않습니다.");
    const requestedStatus = status && status !== "all" ? status : "all";
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
    if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 240) {
      return invalid(traceId, "업무 제목은 1~240자로 입력해 주세요.");
    }
    if (body.description !== undefined && typeof body.description !== "string") {
      return invalid(traceId, "업무 설명 형식이 올바르지 않습니다.");
    }
    if (body.kind !== undefined && !kinds.has(body.kind)) {
      return invalid(traceId, "업무 종류가 올바르지 않습니다.");
    }
    if (body.priority !== undefined && !priorities.has(body.priority)) {
      return invalid(traceId, "우선순위가 올바르지 않습니다.");
    }
    if (body.due_at !== undefined && body.due_at !== null && (typeof body.due_at !== "string" || Number.isNaN(Date.parse(body.due_at)))) {
      return invalid(traceId, "마감 시각 형식이 올바르지 않습니다.");
    }
    if (body.notify_enabled !== undefined && typeof body.notify_enabled !== "boolean") {
      return invalid(traceId, "알림 설정 형식이 올바르지 않습니다.");
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
      kind?: ScheduleWorkItemKind; priority?: ScheduleWorkItemPriority; due_at?: string | null; notify_enabled?: boolean;
    };
    if (typeof body.id !== "string" || !body.id.trim()) {
      return invalid(traceId, "업무 항목 ID가 필요합니다.");
    }
    if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 240)) {
      return invalid(traceId, "업무 제목은 1~240자로 입력해 주세요.");
    }
    if (body.description !== undefined && typeof body.description !== "string") {
      return invalid(traceId, "업무 설명 형식이 올바르지 않습니다.");
    }
    if (body.status !== undefined && !statuses.has(body.status)) {
      return invalid(traceId, "업무 상태가 올바르지 않습니다.");
    }
    if (body.kind !== undefined && !kinds.has(body.kind)) {
      return invalid(traceId, "업무 종류가 올바르지 않습니다.");
    }
    if (body.priority !== undefined && !priorities.has(body.priority)) {
      return invalid(traceId, "우선순위가 올바르지 않습니다.");
    }
    if (body.due_at !== undefined && body.due_at !== null && (typeof body.due_at !== "string" || Number.isNaN(Date.parse(body.due_at)))) {
      return invalid(traceId, "마감 시각 형식이 올바르지 않습니다.");
    }
    if (body.notify_enabled !== undefined && typeof body.notify_enabled !== "boolean") {
      return invalid(traceId, "알림 설정 형식이 올바르지 않습니다.");
    }
    await updateScheduleWorkItem(principal, body.id, {
      title: body.title, description: body.description, status: body.status, kind: body.kind, priority: body.priority,
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
