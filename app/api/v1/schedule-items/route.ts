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
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as ScheduleWorkItemStatus | "all" | null;
    if (status && status !== "all" && !statuses.has(status)) return invalid(traceId, "업무 상태 필터가 올바르지 않습니다.");
    const requestedStatus = status && status !== "all" ? status : "all";
    return ok({ items: await listScheduleWorkItems(principal, { status: requestedStatus, projectId: url.searchParams.get("project_id") || undefined }), notifications: await listScheduleAlerts(principal) }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const body = await request.json() as {
      title?: string; description?: string; kind?: ScheduleWorkItemKind; priority?: ScheduleWorkItemPriority;
      due_at?: string | null; notify_enabled?: boolean; project_id?: string | null; parent_id?: string | null;
    };
    if (typeof body.title !== "string" || body.title.trim().length < 2 || body.title.trim().length > 240) {
      return invalid(traceId, "업무 제목은 2~240자로 입력해 주세요.");
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
    if ((body.project_id !== undefined && body.project_id !== null && (typeof body.project_id !== "string" || body.project_id.length > 200))
      || (body.parent_id !== undefined && body.parent_id !== null && (typeof body.parent_id !== "string" || body.parent_id.length > 200))) return invalid(traceId, "프로젝트 또는 상위 업무 형식이 올바르지 않습니다.");
    const id = await createScheduleWorkItem({
      principal,
      title: body.title,
      description: body.description,
      kind: body.kind,
      priority: body.priority,
      dueAt: body.due_at,
      notifyEnabled: body.notify_enabled !== false,
      projectId: body.project_id,
      parentId: body.parent_id,
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
      kind?: ScheduleWorkItemKind; priority?: ScheduleWorkItemPriority; due_at?: string | null; notify_enabled?: boolean; project_id?: string | null; parent_id?: string | null;
      detail_content?: string; image_asset_ids?: string[];
    };
    if (typeof body.id !== "string" || !body.id.trim()) {
      return invalid(traceId, "업무 항목 ID가 필요합니다.");
    }
    if (body.title !== undefined && (typeof body.title !== "string" || body.title.trim().length < 2 || body.title.trim().length > 240)) {
      return invalid(traceId, "업무 제목은 2~240자로 입력해 주세요.");
    }
    if (body.description !== undefined && typeof body.description !== "string") {
      return invalid(traceId, "업무 설명 형식이 올바르지 않습니다.");
    }
    if (body.detail_content !== undefined && (typeof body.detail_content !== "string" || body.detail_content.length > 12_000)) {
      return invalid(traceId, "세부 업무 내용은 12,000자 이내로 입력해 주세요.");
    }
    if (body.image_asset_ids !== undefined && (!Array.isArray(body.image_asset_ids) || body.image_asset_ids.length > 8
      || body.image_asset_ids.some((id) => typeof id !== "string" || !id.trim() || id.length > 200))) {
      return invalid(traceId, "업무 이미지는 최대 8개까지 첨부할 수 있습니다.");
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
    if ((body.project_id !== undefined && body.project_id !== null && (typeof body.project_id !== "string" || body.project_id.length > 200))
      || (body.parent_id !== undefined && body.parent_id !== null && (typeof body.parent_id !== "string" || body.parent_id.length > 200))) return invalid(traceId, "프로젝트 또는 상위 업무 형식이 올바르지 않습니다.");
    await updateScheduleWorkItem(principal, body.id, {
      title: body.title, description: body.description, status: body.status, kind: body.kind, priority: body.priority,
      dueAt: body.due_at, notifyEnabled: body.notify_enabled, projectId: body.project_id, parentId: body.parent_id,
      detailContent: body.detail_content, detailImageAssetIds: body.image_asset_ids,
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
