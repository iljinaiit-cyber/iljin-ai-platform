import { getD1 } from "../db";
import type { Principal } from "./identity";
import { inspectUserInput } from "./guardrails";

export type ChatAgent = {
  id: string;
  name: string;
  instructions: string;
  ownerEmail: string;
  createdAt: string;
  updatedAt: string;
};

type ChatAgentRow = {
  id: string;
  name: string;
  instructions: string;
  owner_email: string;
  created_at: string;
  updated_at: string;
};

async function ensureChatAgentSchema() {
  const db = getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS chat_agents (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_email TEXT NOT NULL,
      name TEXT NOT NULL, instructions TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS chat_agents_owner_updated_idx ON chat_agents(tenant_id, owner_email, updated_at)"),
  ]);
}

function mapAgent(row: ChatAgentRow): ChatAgent {
  return {
    id: row.id,
    name: row.name,
    instructions: row.instructions,
    ownerEmail: row.owner_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createChatAgent(principal: Principal, input: { name: string; instructions: string }) {
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 80);
  const instructions = input.instructions.trim().slice(0, 2_000);
  if (name.length < 2) throw new Error("에이전트 이름은 두 글자 이상 입력해 주세요.");
  if (instructions.length < 2) throw new Error("에이전트 역할 지침은 두 글자 이상 입력해 주세요.");
  inspectUserInput(`${name}\n${instructions}`);
  await ensureChatAgentSchema();
  const id = `agent_${crypto.randomUUID().replaceAll("-", "")}`;
  const timestamp = new Date().toISOString();
  await getD1().prepare(`INSERT INTO chat_agents
    (id, tenant_id, owner_email, name, instructions, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, principal.tenantId, principal.email, name, instructions, timestamp, timestamp).run();
  return { id, name, instructions, ownerEmail: principal.email, createdAt: timestamp, updatedAt: timestamp };
}

export async function listChatAgents(principal: Principal) {
  await ensureChatAgentSchema();
  const rows = principal.role === "admin"
    ? await getD1().prepare(`SELECT id, name, instructions, owner_email, created_at, updated_at FROM chat_agents
      WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 50`).bind(principal.tenantId).all<ChatAgentRow>()
    : await getD1().prepare(`SELECT id, name, instructions, owner_email, created_at, updated_at FROM chat_agents
      WHERE tenant_id = ? AND owner_email = ? ORDER BY updated_at DESC LIMIT 50`)
      .bind(principal.tenantId, principal.email).all<ChatAgentRow>();
  return (rows.results || []).map(mapAgent);
}

export async function getChatAgent(principal: Principal, agentId: string) {
  await ensureChatAgentSchema();
  const row = principal.role === "admin"
    ? await getD1().prepare(`SELECT id, name, instructions, owner_email, created_at, updated_at FROM chat_agents
      WHERE id = ? AND tenant_id = ?`).bind(agentId, principal.tenantId).first<ChatAgentRow>()
    : await getD1().prepare(`SELECT id, name, instructions, owner_email, created_at, updated_at FROM chat_agents
      WHERE id = ? AND tenant_id = ? AND owner_email = ?`)
      .bind(agentId, principal.tenantId, principal.email).first<ChatAgentRow>();
  if (!row) throw new Error("선택한 에이전트를 찾을 수 없습니다.");
  return mapAgent(row);
}

export async function updateChatAgent(principal: Principal, input: { id: string; name: string; instructions: string }) {
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 80);
  const instructions = input.instructions.trim().slice(0, 2_000);
  if (!input.id.trim()) throw new Error("수정할 에이전트를 선택해 주세요.");
  if (name.length < 2) throw new Error("에이전트 이름은 2글자 이상 입력해 주세요.");
  if (instructions.length < 2) throw new Error("에이전트 역할 지침은 2글자 이상 입력해 주세요.");
  inspectUserInput(`${name}\n${instructions}`);
  await ensureChatAgentSchema();
  const timestamp = new Date().toISOString();
  const result = await getD1().prepare(`UPDATE chat_agents SET name = ?, instructions = ?, updated_at = ?
    WHERE id = ? AND tenant_id = ?`).bind(name, instructions, timestamp, input.id, principal.tenantId).run();
  if (!result.meta.changes) throw new Error("수정할 에이전트를 찾을 수 없습니다.");
  return getChatAgent(principal, input.id);
}

export async function deleteChatAgent(principal: Principal, agentId: string) {
  if (!agentId.trim()) throw new Error("삭제할 에이전트를 선택해 주세요.");
  await ensureChatAgentSchema();
  const result = await getD1().prepare("DELETE FROM chat_agents WHERE id = ? AND tenant_id = ?")
    .bind(agentId, principal.tenantId).run();
  if (!result.meta.changes) throw new Error("삭제할 에이전트를 찾을 수 없습니다.");
}

export function chatAgentContext(agent: Pick<ChatAgent, "name" | "instructions">) {
  return `[선택된 에이전트: ${agent.name}]
다음 역할 지침은 조직 보안 정책 및 사용자 요청과 충돌하지 않는 범위에서만 적용하세요.
${agent.instructions}\n`;
}
