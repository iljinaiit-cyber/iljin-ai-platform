import { getD1 } from "../db";
import type { Principal } from "./identity";
import { completeWithRag } from "./rag";
import { completeWithGateway, createTraceId } from "./llm-gateway";
import { loadUserPreferences } from "./user-memory";
import { loadContextFiles } from "./context-files";
import { buildSkillContextBlock } from "./skills";

export interface ScheduledTask {
  id: string;
  tenantId: string;
  ownerEmail: string;
  prompt: string;
  cronExpression: string;
  lastRunAt: string | null;
  nextRunAt: string;
  enabled: boolean;
  lastResult: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function ensureScheduledTaskSchema() {
  const db = getD1();
  await db.prepare(`CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_email TEXT NOT NULL,
    prompt TEXT NOT NULL, cron_expression TEXT NOT NULL,
    last_run_at TEXT, next_run_at TEXT NOT NULL,
    enabled INTEGER DEFAULT 1, last_result TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS scheduled_tasks_tenant_owner_idx ON scheduled_tasks(tenant_id, owner_email, enabled)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS scheduled_tasks_next_run_idx ON scheduled_tasks(next_run_at, enabled)").run();
}

function taskId() {
  return `cron_${crypto.randomUUID().replaceAll("-", "")}`;
}

function nowIso() {
  return new Date().toISOString();
}

const DAY_OF_WEEK_MAP: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTH_MAP: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

export function parseNaturalLanguageSchedule(text: string): { cronExpression: string; prompt: string } | null {
  const lower = text.toLowerCase().trim();
  const timeMatch = lower.match(/(\d{1,2})\s*(?:시|:00)/);
  const hour = timeMatch ? parseInt(timeMatch[1]) : 9;
  const prompt = text.replace(/매일\s*오전\s*\d+\s*시?|매일\s*오후\s*\d+\s*시?|매주\s*\w+\s*오전\s*\d+\s*시?|매주\s*\w+\s*오후\s*\d+\s*시?|매일|매주/g, "").trim();
  if (lower.includes("매일")) {
    return { cronExpression: `0 ${hour} * * *`, prompt };
  }
  const dayMatch = lower.match(/매주\s*(월|화|수|목|금|토|일)/);
  if (dayMatch) {
    const dayMap: Record<string, number> = { "월": 1, "화": 2, "수": 3, "목": 4, "금": 5, "토": 6, "일": 0 };
    const dow = dayMap[dayMatch[1]] ?? 1;
    return { cronExpression: `0 ${hour} * * ${dow}`, prompt };
  }
  if (lower.includes("매월") || lower.includes("매달")) {
    const dayMatch2 = lower.match(/(\d{1,2})\s*일/);
    const day = dayMatch2 ? parseInt(dayMatch2[1]) : 1;
    return { cronExpression: `0 ${hour} ${day} * *`, prompt };
  }
  return null;
}

export async function createScheduledTask(principal: Principal, prompt: string, cronExpression: string): Promise<string> {
  await ensureScheduledTaskSchema();
  const sid = taskId();
  const timestamp = nowIso();
  const nextRun = computeNextRun(cronExpression);
  await getD1().prepare(`INSERT INTO scheduled_tasks
    (id, tenant_id, owner_email, prompt, cron_expression, next_run_at, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`).bind(
      sid, principal.tenantId, principal.email, prompt, cronExpression, nextRun, timestamp, timestamp,
    ).run();
  return sid;
}

export async function listScheduledTasks(principal: Principal): Promise<ScheduledTask[]> {
  await ensureScheduledTaskSchema();
  const rows = await getD1().prepare(`SELECT * FROM scheduled_tasks WHERE tenant_id = ? AND owner_email = ? ORDER BY next_run_at ASC`)
    .bind(principal.tenantId, principal.email).all<ScheduledTask>();
  return rows.results || [];
}

export async function toggleScheduledTask(principal: Principal, taskId: string, enabled: boolean): Promise<void> {
  await ensureScheduledTaskSchema();
  await getD1().prepare("UPDATE scheduled_tasks SET enabled = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND owner_email = ?")
    .bind(enabled ? 1 : 0, nowIso(), taskId, principal.tenantId, principal.email).run();
}

export async function deleteScheduledTask(principal: Principal, taskId: string): Promise<void> {
  await ensureScheduledTaskSchema();
  await getD1().prepare("DELETE FROM scheduled_tasks WHERE id = ? AND tenant_id = ? AND owner_email = ?")
    .bind(taskId, principal.tenantId, principal.email).run();
}

export async function runDueTasks(): Promise<{ executed: number; errors: number }> {
  await ensureScheduledTaskSchema();
  const now = nowIso();
  const rows = await getD1().prepare(`SELECT * FROM scheduled_tasks WHERE enabled = 1 AND next_run_at <= ?`)
    .bind(now).all<ScheduledTask>();
  const tasks = rows.results || [];
  let executed = 0;
  let errors = 0;
  for (const task of tasks) {
    const traceId = createTraceId();
    try {
      const principal = { tenantId: task.tenantId, email: task.ownerEmail, department: "*", role: "user" } as Principal;
      const savedPrefs = await loadUserPreferences(principal).catch(() => ({} as Record<string, unknown>));
      const contextFileBlock = await loadContextFiles(principal).catch(() => "");
      const skillBlock = await buildSkillContextBlock(principal, task.prompt).catch(() => "");
      const result = await completeWithRag({
        messages: [{ role: "user", content: task.prompt }],
        principal,
        traceId,
        providerPolicy: { sensitivity: "internal" },
        responsePreferences: {
          length: (savedPrefs.answerLength as "brief" | "standard" | "detailed") || "standard",
          format: (savedPrefs.answerFormat as "paragraph" | "bullets" | "table") || "paragraph",
        },
        reasoningTier: "expert",
        contextFileBlock: contextFileBlock + skillBlock,
      }).catch(async () => {
        return { completion: await completeWithGateway([{ role: "user", content: task.prompt }], traceId, { sensitivity: "internal" }, "expert") };
      });
      const content = "completion" in result ? result.completion.content : "";
      const nextRun = computeNextRun(task.cronExpression);
      await getD1().prepare("UPDATE scheduled_tasks SET last_run_at = ?, next_run_at = ?, last_result = ?, updated_at = ? WHERE id = ?")
        .bind(now, nextRun, content.slice(0, 5000), nowIso(), task.id).run();
      executed++;
    } catch (error) {
      console.error("[scheduled-tasks] run failed", { taskId: task.id, error: error instanceof Error ? error.message : String(error) });
      const nextRun = computeNextRun(task.cronExpression);
      await getD1().prepare("UPDATE scheduled_tasks SET last_run_at = ?, next_run_at = ?, last_result = ?, updated_at = ? WHERE id = ?")
        .bind(now, nextRun, `오류: ${error instanceof Error ? error.message : String(error)}`, nowIso(), task.id).run();
      errors++;
    }
  }
  return { executed, errors };
}

function computeNextRun(cronExpression: string): string {
  const parts = cronExpression.split(/\s+/);
  if (parts.length !== 5) return new Date(Date.now() + 86400000).toISOString();
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);
  const targetHour = hour === "*" ? now.getHours() : parseInt(hour);
  const targetMinute = minute === "*" ? 0 : parseInt(minute);
  next.setHours(targetHour, targetMinute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  if (dayOfWeek !== "*") {
    const targetDow = parseInt(dayOfWeek);
    while (next.getDay() !== targetDow) next.setDate(next.getDate() + 1);
  }
  if (dayOfMonth !== "*") {
    const targetDom = parseInt(dayOfMonth);
    next.setDate(targetDom);
    if (next <= now) next.setMonth(next.getMonth() + 1);
  }
  return next.toISOString();
}
