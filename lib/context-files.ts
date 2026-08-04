import { getD1 } from "../db";
import type { Principal } from "./identity";

export interface ContextFile {
  id: string;
  tenantId: string;
  department: string;
  role: string;
  filename: string;
  content: string;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function ensureContextFileSchema() {
  const db = getD1();
  await db.prepare(`CREATE TABLE IF NOT EXISTS context_files (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, department TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '*', filename TEXT NOT NULL, content TEXT NOT NULL,
    priority INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS context_files_tenant_dept_idx ON context_files(tenant_id, department, role, enabled)").run();
}

export async function loadContextFiles(principal: Pick<Principal, "tenantId" | "department" | "role">): Promise<string> {
  await ensureContextFileSchema();
  const db = getD1();
  const rows = await db.prepare(`SELECT content, filename, priority FROM context_files
    WHERE tenant_id = ? AND enabled = 1
    AND (department = '*' OR department = ?)
    AND (role = '*' OR role = ?)
    ORDER BY priority DESC, updated_at DESC LIMIT 5`).bind(
      principal.tenantId, principal.department, principal.role,
    ).all<{ content: string; filename: string; priority: number }>();
  const files = rows.results || [];
  if (files.length === 0) return "";
  const blocks = files.map((f) => f.content.slice(0, 2000));
  return `\n[부서 컨텍스트]\n${blocks.join("\n\n")}\n`;
}

export async function listContextFiles(principal: Principal): Promise<Omit<ContextFile, "content">[]> {
  await ensureContextFileSchema();
  const rows = await getD1().prepare(`SELECT id, tenant_id, department, role, filename, priority, enabled, created_at, updated_at
    FROM context_files WHERE tenant_id = ? ORDER BY priority DESC, updated_at DESC`).bind(principal.tenantId).all();
  return (rows.results || []) as Omit<ContextFile, "content">[];
}

export async function upsertContextFile(principal: Principal, file: { id?: string; department: string; role: string; filename: string; content: string; priority?: number; enabled?: boolean }): Promise<string> {
  await ensureContextFileSchema();
  const db = getD1();
  const timestamp = new Date().toISOString();
  const fileid = file.id || `ctx_${crypto.randomUUID().replaceAll("-", "")}`;
  await db.prepare(`INSERT INTO context_files (id, tenant_id, department, role, filename, content, priority, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET department = excluded.department, role = excluded.role,
    filename = excluded.filename, content = excluded.content, priority = excluded.priority,
    enabled = excluded.enabled, updated_at = excluded.updated_at`).bind(
      fileid, principal.tenantId, file.department, file.role || "*",
      file.filename, file.content, file.priority || 0,
      file.enabled === false ? 0 : 1, timestamp, timestamp,
    ).run();
  return fileid;
}

export async function deleteContextFile(principal: Principal, fileId: string): Promise<void> {
  await ensureContextFileSchema();
  await getD1().prepare("DELETE FROM context_files WHERE id = ? AND tenant_id = ?").bind(fileId, principal.tenantId).run();
}
