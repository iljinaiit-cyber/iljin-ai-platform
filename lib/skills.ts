import { getD1 } from "../db";
import type { Principal } from "./identity";
import type { GatewayMessage } from "./llm-gateway";
import { completeWithGateway } from "./llm-gateway";

export interface AgentSkill {
  id: string;
  tenantId: string;
  ownerEmail: string;
  name: string;
  triggerPatterns: string[];
  stepsJson: string;
  evidenceRequirements: string;
  successCount: number;
  failureCount: number;
  status: "draft" | "approved" | "deprecated";
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function ensureSkillSchema() {
  const db = getD1();
  await db.prepare(`CREATE TABLE IF NOT EXISTS agent_skills (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_email TEXT NOT NULL,
    name TEXT NOT NULL, trigger_patterns_json TEXT NOT NULL DEFAULT '[]',
    steps_json TEXT NOT NULL DEFAULT '[]', evidence_requirements TEXT,
    success_count INTEGER DEFAULT 0, failure_count INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft', conversation_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS agent_skills_tenant_owner_idx ON agent_skills(tenant_id, owner_email, status)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS agent_skills_tenant_status_idx ON agent_skills(tenant_id, status)").run();
}

function skillId() {
  return `skill_${crypto.randomUUID().replaceAll("-", "")}`;
}

function nowIso() {
  return new Date().toISOString();
}

const SKILL_EXTRACTION_THRESHOLD = 0.7;

export async function maybeExtractSkill(principal: Principal, conversationId: string, messages: GatewayMessage[], traceId: string, positiveFeedback: boolean): Promise<void> {
  if (!positiveFeedback) return;
  const hasDeep = messages.length >= 4;
  if (!hasDeep) return;
  const conversationText = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-6)
    .map((m) => `${m.role === "user" ? "사용자" : "AI"}: ${m.content.slice(0, 400)}`)
    .join("\n");
  const prompt = `다음 대화에서 사용자가 해결한 작업을 분석하여, 재사용 가능한 스킬을 추출하세요. 스킬은 이런 형식이어야 합니다:

이름: (간단한 한국어 이름)
트리거: (이 스킬을 사용해야 하는 질문 패턴 2-3개)
단계: (해결 절차 3-7단계, 각 단계는 한 문장)
근거요건: (이 스킬이 작동하려면 사내 문서에 어떤 정보가 있어야 하는지)

추출할 가치가 없으면 "없음"이라고 답하세요.

대화:
${conversationText}

스킬:`;
  try {
    const completion = await completeWithGateway(
      [{ role: "user", content: prompt }],
      traceId,
      { maxOutputTokens: 600, sensitivity: "internal" },
      "swift",
    );
    if (completion.content.trim() === "없음" || completion.content.trim().length < 20) return;
    await ensureSkillSchema();
    const parsed = parseSkillResponse(completion.content, conversationId);
    if (!parsed) return;
    await getD1().prepare(`INSERT INTO agent_skills
      (id, tenant_id, owner_email, name, trigger_patterns_json, steps_json, evidence_requirements, success_count, failure_count, status, conversation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 'draft', ?, ?, ?)`).bind(
        skillId(), principal.tenantId, principal.email,
        parsed.name, JSON.stringify(parsed.triggerPatterns), JSON.stringify(parsed.steps),
        parsed.evidenceRequirements, conversationId, nowIso(), nowIso(),
      ).run();
  } catch (error) {
    console.error("[skills] extract failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

interface ParsedSkill {
  name: string;
  triggerPatterns: string[];
  steps: string[];
  evidenceRequirements: string;
}

function parseSkillResponse(text: string, conversationId: string): ParsedSkill | null {
  const nameMatch = text.match(/이름[:\s]+(.+)/);
  const triggerMatch = text.match(/트리거[:\s]+([\s\S]+?)(?=단계:|$)/);
  const stepsMatch = text.match(/단계[:\s]+([\s\S]+?)(?=근거요건:|$)/);
  const evidenceMatch = text.match(/근거요건[:\s]+([\s\S]+)/);
  if (!nameMatch || !stepsMatch) return null;
  const name = nameMatch[1].trim().slice(0, 100);
  const triggerPatterns = (triggerMatch?.[1] || "")
    .split("\n").map((l) => l.replace(/^\d+\.\s*/, "").trim())
    .filter((l) => l && l.length > 2).slice(0, 5);
  const steps = stepsMatch[1]
    .split("\n").map((l) => l.replace(/^\d+\.\s*/, "").trim())
    .filter((l) => l && l.length > 2).slice(0, 7);
  const evidenceRequirements = (evidenceMatch?.[1] || "").trim().slice(0, 500);
  if (!name || steps.length === 0) return null;
  return { name, triggerPatterns, steps, evidenceRequirements };
}

export async function findRelevantSkill(principal: Principal, query: string): Promise<AgentSkill | null> {
  await ensureSkillSchema();
  const rows = await getD1().prepare(`SELECT * FROM agent_skills
    WHERE tenant_id = ? AND status = 'approved' ORDER BY success_count DESC LIMIT 50`).bind(principal.tenantId).all<AgentSkill & { trigger_patterns_json: string; steps_json: string }>();
  const skills = (rows.results || []);
  if (skills.length === 0) return null;
  const queryLower = query.toLowerCase();
  for (const skill of skills) {
    const patterns: string[] = JSON.parse(skill.trigger_patterns_json || "[]");
    const matched = patterns.some((p) => {
      const pLower = p.toLowerCase();
      return queryLower.includes(pLower) || pLower.includes(queryLower.slice(0, 10));
    });
    if (matched) {
      return {
        ...skill,
        triggerPatterns: patterns,
        stepsJson: skill.steps_json,
      } as AgentSkill;
    }
  }
  return null;
}

export async function buildSkillContextBlock(principal: Principal, query: string): Promise<string> {
  const skill = await findRelevantSkill(principal, query);
  if (!skill) return "";
  const steps: string[] = JSON.parse(skill.stepsJson || "[]");
  if (steps.length === 0) return "";
  const stepsBlock = steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return `\n[관련 스킬: ${skill.name}]\n${stepsBlock}\n`;
}

export async function recordSkillOutcome(principal: Principal, conversationId: string, success: boolean): Promise<void> {
  await ensureSkillSchema();
  const skill = await getD1().prepare(`SELECT id FROM agent_skills WHERE tenant_id = ? AND conversation_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(principal.tenantId, conversationId).first<{ id: string }>();
  if (!skill) return;
  const column = success ? "success_count" : "failure_count";
  await getD1().prepare(`UPDATE agent_skills SET ${column} = ${column} + 1, updated_at = ? WHERE id = ?`)
    .bind(nowIso(), skill.id).run();
}

export async function listSkills(principal: Principal): Promise<AgentSkill[]> {
  await ensureSkillSchema();
  const rows = await getD1().prepare(`SELECT * FROM agent_skills WHERE tenant_id = ? ORDER BY status, updated_at DESC`)
    .bind(principal.tenantId).all<AgentSkill & { trigger_patterns_json: string; steps_json: string }>();
  return (rows.results || []).map((r) => ({
    ...r,
    triggerPatterns: JSON.parse(r.trigger_patterns_json || "[]"),
    stepsJson: r.steps_json,
  })) as AgentSkill[];
}

export async function approveSkill(principal: Principal, skillId: string): Promise<void> {
  await ensureSkillSchema();
  await getD1().prepare("UPDATE agent_skills SET status = 'approved', updated_at = ? WHERE id = ? AND tenant_id = ?")
    .bind(nowIso(), skillId, principal.tenantId).run();
}

export async function deprecateSkill(principal: Principal, skillId: string): Promise<void> {
  await ensureSkillSchema();
  await getD1().prepare("UPDATE agent_skills SET status = 'deprecated', updated_at = ? WHERE id = ? AND tenant_id = ?")
    .bind(nowIso(), skillId, principal.tenantId).run();
}
