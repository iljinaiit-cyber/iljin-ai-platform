import { getD1 } from "../db";
import type { Principal } from "./identity";

export type ScheduleWorkItemKind = "todo" | "milestone" | "reminder" | "execution";
export type ScheduleWorkItemStatus = "open" | "in_progress" | "done" | "failed" | "cancelled";
export type ScheduleWorkItemPriority = "low" | "normal" | "high" | "urgent";
export type ScheduleProjectStatus = "active" | "on_hold" | "completed";

export type ScheduleProject = {
  id: string; tenant_id: string; owner_email: string; title: string; description: string | null;
  status: ScheduleProjectStatus; color: string; created_at: string; updated_at: string;
};

export type ScheduleWorkItem = {
  id: string;
  tenant_id: string;
  owner_email: string;
  title: string;
  description: string | null;
  kind: ScheduleWorkItemKind;
  status: ScheduleWorkItemStatus;
  priority: ScheduleWorkItemPriority;
  due_at: string | null;
  reminder_at: string | null;
  source_type: string | null;
  source_id: string | null;
  project_id: string | null;
  parent_id: string | null;
  auto_generated: number;
  notify_enabled: number;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

export type ScheduleAlert = ScheduleWorkItem & { alert_type: "overdue" | "upcoming" };

let schemaReady: Promise<void> | undefined;

async function addMissingColumns(
  table: "schedule_work_items" | "schedule_notifications" | "schedule_projects",
  additions: readonly (readonly [string, string])[],
) {
  const db = getD1();
  const columns = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const names = new Set((columns.results || []).map((column) => column.name));
  const missing = additions.filter(([name]) => !names.has(name));
  if (missing.length) await db.batch(missing.map(([, sql]) => db.prepare(sql)));
}

export async function ensureSchedulePlanningSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = getD1();
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS schedule_work_items (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_email TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '', description TEXT, kind TEXT NOT NULL DEFAULT 'todo',
          status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'normal',
          due_at TEXT, reminder_at TEXT, source_type TEXT, source_id TEXT, project_id TEXT, parent_id TEXT,
          auto_generated INTEGER NOT NULL DEFAULT 0, notify_enabled INTEGER NOT NULL DEFAULT 1,
          metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS schedule_notifications (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_email TEXT NOT NULL,
          work_item_id TEXT NOT NULL, scheduled_at TEXT NOT NULL, delivered_at TEXT,
          created_at TEXT NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS schedule_projects (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_email TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '', description TEXT, status TEXT NOT NULL DEFAULT 'active',
          color TEXT NOT NULL DEFAULT 'blue', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )`),
      ]);
      await addMissingColumns("schedule_work_items", [
        ["tenant_id", "ALTER TABLE schedule_work_items ADD COLUMN tenant_id TEXT NOT NULL DEFAULT ''"],
        ["owner_email", "ALTER TABLE schedule_work_items ADD COLUMN owner_email TEXT NOT NULL DEFAULT ''"],
        ["title", "ALTER TABLE schedule_work_items ADD COLUMN title TEXT NOT NULL DEFAULT ''"],
        ["description", "ALTER TABLE schedule_work_items ADD COLUMN description TEXT"],
        ["kind", "ALTER TABLE schedule_work_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'todo'"],
        ["status", "ALTER TABLE schedule_work_items ADD COLUMN status TEXT NOT NULL DEFAULT 'open'"],
        ["priority", "ALTER TABLE schedule_work_items ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'"],
        ["due_at", "ALTER TABLE schedule_work_items ADD COLUMN due_at TEXT"],
        ["reminder_at", "ALTER TABLE schedule_work_items ADD COLUMN reminder_at TEXT"],
        ["source_type", "ALTER TABLE schedule_work_items ADD COLUMN source_type TEXT"],
        ["source_id", "ALTER TABLE schedule_work_items ADD COLUMN source_id TEXT"],
        ["project_id", "ALTER TABLE schedule_work_items ADD COLUMN project_id TEXT"],
        ["parent_id", "ALTER TABLE schedule_work_items ADD COLUMN parent_id TEXT"],
        ["auto_generated", "ALTER TABLE schedule_work_items ADD COLUMN auto_generated INTEGER NOT NULL DEFAULT 0"],
        ["notify_enabled", "ALTER TABLE schedule_work_items ADD COLUMN notify_enabled INTEGER NOT NULL DEFAULT 1"],
        ["metadata_json", "ALTER TABLE schedule_work_items ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'"],
        ["created_at", "ALTER TABLE schedule_work_items ADD COLUMN created_at TEXT NOT NULL DEFAULT ''"],
        ["updated_at", "ALTER TABLE schedule_work_items ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''"],
      ]);
      await addMissingColumns("schedule_notifications", [
        ["tenant_id", "ALTER TABLE schedule_notifications ADD COLUMN tenant_id TEXT NOT NULL DEFAULT ''"],
        ["owner_email", "ALTER TABLE schedule_notifications ADD COLUMN owner_email TEXT NOT NULL DEFAULT ''"],
        ["work_item_id", "ALTER TABLE schedule_notifications ADD COLUMN work_item_id TEXT NOT NULL DEFAULT ''"],
        ["scheduled_at", "ALTER TABLE schedule_notifications ADD COLUMN scheduled_at TEXT NOT NULL DEFAULT ''"],
        ["delivered_at", "ALTER TABLE schedule_notifications ADD COLUMN delivered_at TEXT"],
        ["created_at", "ALTER TABLE schedule_notifications ADD COLUMN created_at TEXT NOT NULL DEFAULT ''"],
      ]);
      await addMissingColumns("schedule_projects", [
        ["tenant_id", "ALTER TABLE schedule_projects ADD COLUMN tenant_id TEXT NOT NULL DEFAULT ''"],
        ["owner_email", "ALTER TABLE schedule_projects ADD COLUMN owner_email TEXT NOT NULL DEFAULT ''"],
        ["title", "ALTER TABLE schedule_projects ADD COLUMN title TEXT NOT NULL DEFAULT ''"],
        ["description", "ALTER TABLE schedule_projects ADD COLUMN description TEXT"],
        ["status", "ALTER TABLE schedule_projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"],
        ["color", "ALTER TABLE schedule_projects ADD COLUMN color TEXT NOT NULL DEFAULT 'blue'"],
        ["created_at", "ALTER TABLE schedule_projects ADD COLUMN created_at TEXT NOT NULL DEFAULT ''"],
        ["updated_at", "ALTER TABLE schedule_projects ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''"],
      ]);
      await db.batch([
        db.prepare("CREATE INDEX IF NOT EXISTS schedule_work_items_tenant_status_idx ON schedule_work_items(tenant_id, owner_email, status, due_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS schedule_work_items_source_idx ON schedule_work_items(tenant_id, source_type, source_id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS schedule_notifications_due_idx ON schedule_notifications(tenant_id, owner_email, scheduled_at, delivered_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS schedule_projects_owner_status_idx ON schedule_projects(tenant_id, owner_email, status, updated_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS schedule_work_items_project_idx ON schedule_work_items(tenant_id, owner_email, project_id, parent_id)"),
      ]);
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
}

function nowIso() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function normalizeDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function conciseAutoWorkTitle(value: string) {
  const original = value.replace(/\s+/g, " ").trim();
  const title = original
    .replace(/^(?:[-*•]|\d+[.)])\s*/, "")
    .replace(/^\*{1,2}([^*]+)\*{1,2}\s*[:：-]?\s*/, "$1 ")
    .replace(/^(?:업무|작업|할 일|todo|task)\s*[:：-]\s*/i, "")
    .replace(/^Agent:\s*/i, "")
    .replace(/^(?:(?:오늘|내일|모레|다음\s*주)\s*)?(?:(?:\d{1,2}\s*[/.]\s*\d{1,2}\s*일?|\d{1,2}\s*월\s*\d{1,2}\s*일)\s*)?(?:(?:오전|오후)\s*)?\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?\s*(?:에|까지)?\s*/, "")
    .split(/(?:\s*[\n]|[.?!]|\s*(?:—|–)\s*)/)[0]
    .replace(/\s+(?:있는데|있으니|관련해서|대해서)\s+/g, " ")
    .replace(/\s*(?:해\s*줘|해\s*주세요|해주세요|부탁해|부탁드립니다|해야\s*(?:해|합니다))\s*[.?!]*$/, "")
    .trim();
  if (title.length <= 48) return title || original.slice(0, 48);
  const boundary = title.lastIndexOf(" ", 48);
  return title.slice(0, boundary > 16 ? boundary : 48).trim();
}

function defaultReminder(dueAt: string | null, notifyEnabled: boolean) {
  if (!dueAt || !notifyEnabled) return null;
  const dueTime = Date.parse(dueAt);
  if (Number.isNaN(dueTime)) return null;
  const reminderTime = dueTime - 15 * 60 * 1000;
  return reminderTime > Date.now() ? new Date(reminderTime).toISOString() : null;
}

export async function createScheduleProject(input: { principal: Principal; title: string; description?: string; color?: string }) {
  await ensureSchedulePlanningSchema();
  const title = input.title.trim().slice(0, 120);
  if (title.length < 2) throw new Error("프로젝트 이름은 2자 이상이어야 합니다.");
  const timestamp = nowIso();
  const projectId = id("project");
  await getD1().prepare(`INSERT INTO schedule_projects
    (id, tenant_id, owner_email, title, description, status, color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`)
    .bind(projectId, input.principal.tenantId, input.principal.email, title, input.description?.trim().slice(0, 1000) || null, input.color || "blue", timestamp, timestamp).run();
  return projectId;
}

export async function listScheduleProjects(principal: Principal) {
  await ensureSchedulePlanningSchema();
  const rows = await getD1().prepare(`SELECT * FROM schedule_projects
    WHERE tenant_id = ? AND owner_email = ? ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END, updated_at DESC`)
    .bind(principal.tenantId, principal.email).all<ScheduleProject>();
  return rows.results || [];
}

export async function updateScheduleProject(principal: Principal, projectId: string, patch: { title?: string; description?: string; status?: ScheduleProjectStatus; color?: string }) {
  await ensureSchedulePlanningSchema();
  const current = await getD1().prepare("SELECT * FROM schedule_projects WHERE id = ? AND tenant_id = ? AND owner_email = ?")
    .bind(projectId, principal.tenantId, principal.email).first<ScheduleProject>();
  if (!current) throw new Error("프로젝트를 찾을 수 없습니다.");
  const title = patch.title === undefined ? current.title : patch.title.trim().slice(0, 120);
  if (title.length < 2) throw new Error("프로젝트 이름은 2자 이상이어야 합니다.");
  await getD1().prepare(`UPDATE schedule_projects SET title = ?, description = ?, status = ?, color = ?, updated_at = ?
    WHERE id = ? AND tenant_id = ? AND owner_email = ?`)
    .bind(title, patch.description === undefined ? current.description : patch.description.trim().slice(0, 1000) || null,
      patch.status || current.status, patch.color || current.color, nowIso(), projectId, principal.tenantId, principal.email).run();
}

export async function deleteScheduleProject(principal: Principal, projectId: string) {
  await ensureSchedulePlanningSchema();
  const db = getD1();
  await db.batch([
    db.prepare("UPDATE schedule_work_items SET project_id = NULL, updated_at = ? WHERE tenant_id = ? AND owner_email = ? AND project_id = ?")
      .bind(nowIso(), principal.tenantId, principal.email, projectId),
    db.prepare("DELETE FROM schedule_projects WHERE id = ? AND tenant_id = ? AND owner_email = ?").bind(projectId, principal.tenantId, principal.email),
  ]);
}

export async function createScheduleWorkItem(input: {
  principal: Principal;
  title: string;
  description?: string;
  kind?: ScheduleWorkItemKind;
  status?: ScheduleWorkItemStatus;
  priority?: ScheduleWorkItemPriority;
  dueAt?: string | null;
  reminderAt?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  projectId?: string | null;
  parentId?: string | null;
  autoGenerated?: boolean;
  notifyEnabled?: boolean;
  metadata?: Record<string, unknown>;
}) {
  await ensureSchedulePlanningSchema();
  const rawTitle = input.title.trim();
  const title = (input.autoGenerated ? conciseAutoWorkTitle(rawTitle) : rawTitle).slice(0, 240);
  if (title.length < 2) throw new Error("업무 제목은 2자 이상이어야 합니다.");
  const description = input.autoGenerated
    ? ["자동 등록 요청", rawTitle, input.description?.trim() && input.description.trim() !== rawTitle ? `세부 내용\n${input.description.trim()}` : ""].filter(Boolean).join("\n\n")
    : input.description?.trim();
  const db = getD1();
  if (input.sourceType && input.sourceId) {
    const existing = await db.prepare(`SELECT id FROM schedule_work_items
      WHERE tenant_id = ? AND owner_email = ? AND source_type = ? AND source_id = ?
        AND status NOT IN ('done', 'failed', 'cancelled') LIMIT 1`)
      .bind(input.principal.tenantId, input.principal.email, input.sourceType, input.sourceId).first<{ id: string }>();
    if (existing) return existing.id;
  }
  const timestamp = nowIso();
  const dueAt = normalizeDate(input.dueAt);
  const notifyEnabled = input.notifyEnabled !== false;
  const activeStatus = input.status !== "done" && input.status !== "cancelled";
  const reminderAt = normalizeDate(input.reminderAt) || defaultReminder(dueAt, notifyEnabled && activeStatus);
  const workItemId = id("work");
  const metadata = JSON.stringify(input.metadata || {});
  const workItemStatement = db.prepare(`INSERT INTO schedule_work_items
    (id, tenant_id, owner_email, title, description, kind, status, priority, due_at, reminder_at,
     source_type, source_id, project_id, parent_id, auto_generated, notify_enabled, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      workItemId, input.principal.tenantId, input.principal.email, title,
      description?.slice(0, 2000) || null, input.kind || "todo", input.status || "open",
      input.priority || "normal", dueAt, reminderAt, input.sourceType || null, input.sourceId || null, input.projectId || null,
      input.parentId || null, input.autoGenerated ? 1 : 0, notifyEnabled ? 1 : 0, metadata, timestamp, timestamp,
    );
  if (reminderAt) {
    const notificationStatement = db.prepare(`INSERT INTO schedule_notifications
      (id, tenant_id, owner_email, work_item_id, scheduled_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id("notification"), input.principal.tenantId, input.principal.email, workItemId, reminderAt, timestamp);
    await db.batch([workItemStatement, notificationStatement]);
  } else await workItemStatement.run();
  return workItemId;
}

export async function listScheduleWorkItems(principal: Principal, options?: { status?: ScheduleWorkItemStatus | "all"; projectId?: string; limit?: number }) {
  await ensureSchedulePlanningSchema();
  const limit = Math.min(Math.max(options?.limit || 100, 1), 200);
  const status = options?.status && options.status !== "all" ? options.status : null;
  const rows = await getD1().prepare(`SELECT * FROM schedule_work_items
    WHERE tenant_id = ? AND owner_email = ? AND (? IS NULL OR status = ?) AND (? IS NULL OR project_id = ?)
    ORDER BY CASE WHEN status IN ('done', 'cancelled') THEN 1 ELSE 0 END, due_at IS NULL, due_at ASC, created_at DESC LIMIT ?`)
    .bind(principal.tenantId, principal.email, status, status, options?.projectId || null, options?.projectId || null, limit).all<ScheduleWorkItem>();
  return rows.results || [];
}

export async function updateScheduleWorkItem(principal: Principal, workItemId: string, patch: {
  title?: string; description?: string; kind?: ScheduleWorkItemKind; status?: ScheduleWorkItemStatus;
  priority?: ScheduleWorkItemPriority; dueAt?: string | null; notifyEnabled?: boolean; projectId?: string | null; parentId?: string | null;
  detailContent?: string; detailImageAssetIds?: string[];
}) {
  await ensureSchedulePlanningSchema();
  const current = await getD1().prepare("SELECT * FROM schedule_work_items WHERE id = ? AND tenant_id = ? AND owner_email = ?")
    .bind(workItemId, principal.tenantId, principal.email).first<ScheduleWorkItem>();
  if (!current) throw new Error("업무 항목을 찾을 수 없습니다.");
  const title = patch.title === undefined ? current.title : patch.title.trim().slice(0, 240);
  if (title.length < 2) throw new Error("업무 제목은 2자 이상이어야 합니다.");
  const dueAt = patch.dueAt === undefined ? current.due_at : normalizeDate(patch.dueAt);
  const notifyEnabled = patch.notifyEnabled === undefined ? Boolean(current.notify_enabled) : patch.notifyEnabled;
  const status = patch.status || current.status;
  const projectId = patch.projectId === undefined ? current.project_id : patch.projectId;
  const parentId = patch.parentId === undefined ? current.parent_id : patch.parentId;
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(current.metadata_json || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
  } catch { /* Keep malformed legacy metadata from blocking a task update. */ }
  if (patch.detailContent !== undefined) {
    const detailContent = patch.detailContent.trim();
    if (detailContent) metadata.detail_content = detailContent;
    else delete metadata.detail_content;
  }
  if (patch.detailImageAssetIds !== undefined) {
    if (patch.detailImageAssetIds.length) metadata.image_asset_ids = patch.detailImageAssetIds;
    else delete metadata.image_asset_ids;
  }
  const reminderAt = defaultReminder(dueAt, notifyEnabled && status !== "done" && status !== "cancelled");
  const updatedAt = nowIso();
  await getD1().prepare(`UPDATE schedule_work_items SET title = ?, description = ?, kind = ?, status = ?, priority = ?,
    due_at = ?, reminder_at = ?, notify_enabled = ?, project_id = ?, parent_id = ?, metadata_json = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND owner_email = ?`)
    .bind(title, patch.description === undefined ? current.description : patch.description.trim().slice(0, 2000) || null,
      patch.kind || current.kind, status, patch.priority || current.priority, dueAt, reminderAt, notifyEnabled ? 1 : 0, projectId, parentId,
      JSON.stringify(metadata), updatedAt, workItemId, principal.tenantId, principal.email).run();
  await getD1().prepare("DELETE FROM schedule_notifications WHERE work_item_id = ? AND delivered_at IS NULL").bind(workItemId).run();
  if (reminderAt) {
    await getD1().prepare(`INSERT INTO schedule_notifications
      (id, tenant_id, owner_email, work_item_id, scheduled_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id("notification"), principal.tenantId, principal.email, workItemId, reminderAt, updatedAt).run();
  }
}

export async function deleteScheduleWorkItem(principal: Principal, workItemId: string) {
  await ensureSchedulePlanningSchema();
  await getD1().batch([
    getD1().prepare("DELETE FROM schedule_notifications WHERE work_item_id = ? AND tenant_id = ? AND owner_email = ?").bind(workItemId, principal.tenantId, principal.email),
    getD1().prepare("DELETE FROM schedule_work_items WHERE id = ? AND tenant_id = ? AND owner_email = ?").bind(workItemId, principal.tenantId, principal.email),
  ]);
}

export async function deleteScheduleWorkItemsForSource(principal: Principal, sourceType: string, sourceId: string) {
  await ensureSchedulePlanningSchema();
  await getD1().batch([
    getD1().prepare("DELETE FROM schedule_notifications WHERE tenant_id = ? AND owner_email = ? AND work_item_id IN (SELECT id FROM schedule_work_items WHERE tenant_id = ? AND owner_email = ? AND source_type = ? AND source_id = ?)").bind(principal.tenantId, principal.email, principal.tenantId, principal.email, sourceType, sourceId),
    getD1().prepare("DELETE FROM schedule_work_items WHERE tenant_id = ? AND owner_email = ? AND source_type = ? AND source_id = ?").bind(principal.tenantId, principal.email, sourceType, sourceId),
  ]);
}

export async function deleteScheduleWorkItemsForConversation(principal: Principal, conversationId: string) {
  await ensureSchedulePlanningSchema();
  await getD1().batch([
    getD1().prepare(`DELETE FROM schedule_notifications WHERE tenant_id = ? AND owner_email = ? AND work_item_id IN (
      SELECT id FROM schedule_work_items WHERE tenant_id = ? AND owner_email = ? AND source_type = 'conversation_message'
        AND source_id IN (SELECT id FROM messages WHERE conversation_id = ?)
      UNION SELECT id FROM schedule_work_items WHERE tenant_id = ? AND owner_email = ? AND source_type = 'assistant_message'
        AND EXISTS (SELECT 1 FROM messages WHERE conversation_id = ? AND schedule_work_items.source_id LIKE messages.id || ':%'))`).bind(principal.tenantId, principal.email, principal.tenantId, principal.email, conversationId, principal.tenantId, principal.email, conversationId),
    getD1().prepare(`DELETE FROM schedule_work_items WHERE tenant_id = ? AND owner_email = ? AND source_type = 'conversation_message'
      AND source_id IN (SELECT id FROM messages WHERE conversation_id = ?)
      OR tenant_id = ? AND owner_email = ? AND source_type = 'assistant_message'
      AND EXISTS (SELECT 1 FROM messages WHERE conversation_id = ? AND schedule_work_items.source_id LIKE messages.id || ':%')`)
      .bind(principal.tenantId, principal.email, conversationId, principal.tenantId, principal.email, conversationId),
  ]);
}

export async function syncScheduleWorkItemStatus(principal: Principal, sourceType: string, sourceId: string, status: ScheduleWorkItemStatus) {
  await ensureSchedulePlanningSchema();
  const db = getD1();
  const updatedAt = nowIso();
  await db.prepare(`UPDATE schedule_work_items SET status = ?, updated_at = ?
    WHERE tenant_id = ? AND owner_email = ? AND source_type = ? AND source_id = ?`)
    .bind(status, updatedAt, principal.tenantId, principal.email, sourceType, sourceId).run();
  const items = await db.prepare(`SELECT id, due_at, notify_enabled FROM schedule_work_items
    WHERE tenant_id = ? AND owner_email = ? AND source_type = ? AND source_id = ?`)
    .bind(principal.tenantId, principal.email, sourceType, sourceId).all<Pick<ScheduleWorkItem, "id" | "due_at" | "notify_enabled">>();
  for (const item of items.results || []) {
    const reminderAt = defaultReminder(item.due_at, status !== "done" && status !== "cancelled" && Boolean(item.notify_enabled));
    await db.prepare("UPDATE schedule_work_items SET reminder_at = ? WHERE id = ? AND tenant_id = ? AND owner_email = ?")
      .bind(reminderAt, item.id, principal.tenantId, principal.email).run();
    await db.prepare("DELETE FROM schedule_notifications WHERE work_item_id = ? AND tenant_id = ? AND owner_email = ? AND delivered_at IS NULL")
      .bind(item.id, principal.tenantId, principal.email).run();
    if (reminderAt) {
      await db.prepare(`INSERT INTO schedule_notifications
        (id, tenant_id, owner_email, work_item_id, scheduled_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(id("notification"), principal.tenantId, principal.email, item.id, reminderAt, updatedAt).run();
    }
  }
}

export async function listScheduleAlerts(principal: Principal, limit = 8): Promise<ScheduleAlert[]> {
  await ensureSchedulePlanningSchema();
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const rows = await getD1().prepare(`SELECT *, CASE WHEN due_at < ? THEN 'overdue' ELSE 'upcoming' END AS alert_type
    FROM schedule_work_items WHERE tenant_id = ? AND owner_email = ?
      AND status IN ('open', 'in_progress', 'failed') AND due_at IS NOT NULL AND due_at <= ?
    ORDER BY CASE WHEN due_at < ? THEN 0 ELSE 1 END, due_at ASC LIMIT ?`)
    .bind(now.toISOString(), principal.tenantId, principal.email, horizon, now.toISOString(), limit).all<ScheduleAlert>();
  return rows.results || [];
}

export function extractDueAtFromText(text: string, now = new Date()) {
  const kstText = text.toLowerCase();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((value) => value.type === type)?.value);
  const year = part("year");
  let month = part("month") - 1;
  let day = part("day");
  const monthDay = kstText.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  const slashDate = kstText.match(/(\d{1,2})\s*[/.]\s*(\d{1,2})\s*일?/);
  const explicitDate = monthDay || slashDate;
  if (explicitDate) { month = Number(explicitDate[1]) - 1; day = Number(explicitDate[2]); }
  else if (kstText.includes("모레")) day += 2;
  else if (kstText.includes("내일")) day += 1;
  else if (!kstText.includes("오늘")) return null;
  const time = kstText.match(/(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
  const hour = time ? Number(time[1]) + (kstText.includes("오후") && Number(time[1]) < 12 ? 12 : 0) : 18;
  const minute = time?.[2] ? Number(time[2]) : 0;
  let kstTime = Date.UTC(year, month, day, hour, minute, 0, 0);
  const nowKstTime = Date.UTC(year, part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  if (explicitDate && kstTime < nowKstTime) kstTime = Date.UTC(year + 1, month, day, hour, minute, 0, 0);
  return new Date(kstTime - 9 * 60 * 60 * 1000).toISOString();
}

export async function registerWorkItemFromText(input: { principal: Principal; text: string; sourceId: string; conversationId?: string }) {
  const text = input.text.trim();
  if (!/(할 일|해야|todo|마감|완료|준비|제출|검토|작성|정리|확인|보고서|회의|리서치|조사|자료)/i.test(text)) return null;
  const dueAt = extractDueAtFromText(text);
  return createScheduleWorkItem({
    principal: input.principal,
    title: text.replace(/\s+/g, " ").slice(0, 120),
    description: "대화에서 자동 등록된 업무입니다. 조사 내용은 원래 대화에서 열람할 수 있습니다.",
    kind: "todo",
    priority: /긴급|오늘|마감/.test(text) ? "high" : "normal",
    dueAt,
    sourceType: "conversation_message",
    sourceId: input.sourceId,
    autoGenerated: true,
    notifyEnabled: Boolean(dueAt),
    metadata: input.conversationId ? { conversationId: input.conversationId } : undefined,
  });
}
