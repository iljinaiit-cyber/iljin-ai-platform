import { getD1 } from "../db";
import type { Principal } from "./identity";
import { inspectUserInput } from "./guardrails";

export type McpProfile = {
  id: string;
  name: string;
  endpoint: string;
  instructions: string;
  ownerEmail: string;
  createdAt: string;
  updatedAt: string;
};

type McpProfileRow = {
  id: string;
  name: string;
  endpoint: string;
  instructions: string;
  owner_email: string;
  created_at: string;
  updated_at: string;
};

async function ensureMcpProfileSchema() {
  const db = getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS mcp_profiles (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_email TEXT NOT NULL,
      name TEXT NOT NULL, endpoint TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS mcp_profiles_owner_updated_idx ON mcp_profiles(tenant_id, owner_email, updated_at)"),
  ]);
}

function mapProfile(row: McpProfileRow): McpProfile {
  return { id: row.id, name: row.name, endpoint: row.endpoint, instructions: row.instructions, ownerEmail: row.owner_email, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function createMcpProfile(principal: Principal, input: { name: string; endpoint?: string; instructions: string }) {
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 80);
  const endpoint = input.endpoint?.trim().slice(0, 500) || "";
  const instructions = input.instructions.trim().slice(0, 2_000);
  if (name.length < 2) throw new Error("MCP 이름은 두 글자 이상 입력해 주세요.");
  if (instructions.length < 2) throw new Error("MCP 사용 지침은 두 글자 이상 입력해 주세요.");
  if (endpoint && !/^https?:\/\//i.test(endpoint)) throw new Error("MCP 서버 주소는 http:// 또는 https://로 시작해야 합니다.");
  inspectUserInput(`${name}\n${endpoint}\n${instructions}`);
  await ensureMcpProfileSchema();
  const id = `mcp_${crypto.randomUUID().replaceAll("-", "")}`;
  const timestamp = new Date().toISOString();
  await getD1().prepare(`INSERT INTO mcp_profiles (id, tenant_id, owner_email, name, endpoint, instructions, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, principal.tenantId, principal.email, name, endpoint, instructions, timestamp, timestamp).run();
  return { id, name, endpoint, instructions, ownerEmail: principal.email, createdAt: timestamp, updatedAt: timestamp };
}

export async function listMcpProfiles(principal: Principal) {
  await ensureMcpProfileSchema();
  const rows = principal.role === "admin"
    ? await getD1().prepare("SELECT id, name, endpoint, instructions, owner_email, created_at, updated_at FROM mcp_profiles WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 50").bind(principal.tenantId).all<McpProfileRow>()
    : await getD1().prepare("SELECT id, name, endpoint, instructions, owner_email, created_at, updated_at FROM mcp_profiles WHERE tenant_id = ? AND owner_email = ? ORDER BY updated_at DESC LIMIT 50").bind(principal.tenantId, principal.email).all<McpProfileRow>();
  return (rows.results || []).map(mapProfile);
}

export async function getMcpProfile(principal: Principal, profileId: string) {
  await ensureMcpProfileSchema();
  const row = principal.role === "admin"
    ? await getD1().prepare("SELECT id, name, endpoint, instructions, owner_email, created_at, updated_at FROM mcp_profiles WHERE id = ? AND tenant_id = ?").bind(profileId, principal.tenantId).first<McpProfileRow>()
    : await getD1().prepare("SELECT id, name, endpoint, instructions, owner_email, created_at, updated_at FROM mcp_profiles WHERE id = ? AND tenant_id = ? AND owner_email = ?").bind(profileId, principal.tenantId, principal.email).first<McpProfileRow>();
  if (!row) throw new Error("선택한 MCP를 찾을 수 없습니다.");
  return mapProfile(row);
}

export function mcpProfileContext(profile: Pick<McpProfile, "name" | "endpoint" | "instructions">) {
  return `[선택된 MCP 프로필: ${profile.name}]\n${profile.endpoint ? `연결 서버: ${profile.endpoint}\n` : ""}이 프로필의 도구 사용 지침을 조직 보안 정책 및 사용자 요청과 충돌하지 않는 범위에서 반영하세요.\n${profile.instructions}\n`;
}
