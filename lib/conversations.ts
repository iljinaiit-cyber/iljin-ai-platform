import { getD1 } from "../db";
import type { Principal } from "./identity";
import type { GatewayCompletion, GatewayMessage } from "./llm-gateway";
import type { RagCitation, WebRagCitation } from "./rag";
import { getConversationSensitivity } from "./llm-telemetry";
import { completeWithGateway } from "./llm-gateway";

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function nowIso() {
  return new Date().toISOString();
}

export class ConversationError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
  }
}

export type ConversationSummary = {
  facts: string[];
  constraints: string[];
  decisions: string[];
  openQuestions: string[];
};

const emptySummary = (): ConversationSummary => ({ facts: [], constraints: [], decisions: [], openQuestions: [] });

function compactSummaryItems(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim().slice(0, 300)).slice(0, 8)
    : [];
}

// 기존 배포본은 summary_json에 문자열을 저장한다. 구조화 전환 중에도 이 대화를
// 잃지 않도록 문자열은 facts 한 건으로 읽어 하위 호환한다.
export function parseConversationSummary(value: unknown): ConversationSummary {
  if (typeof value === "string" && value.trim()) return { ...emptySummary(), facts: [value.trim().slice(0, 1_200)] };
  if (!value || typeof value !== "object") return emptySummary();
  const source = value as Record<string, unknown>;
  return {
    facts: compactSummaryItems(source.facts),
    constraints: compactSummaryItems(source.constraints),
    decisions: compactSummaryItems(source.decisions),
    openQuestions: compactSummaryItems(source.openQuestions),
  };
}

export function conversationSummaryContext(summary: ConversationSummary) {
  const sections = [
    ["확정 사실", summary.facts],
    ["사용자 제약", summary.constraints],
    ["결정 사항", summary.decisions],
    ["미해결 질문", summary.openQuestions],
  ].filter(([, values]) => values.length > 0)
    .map(([label, values]) => `${label}: ${(values as string[]).map((value) => `- ${value}`).join(" ")}`);
  return sections.join("\n");
}

export async function ensureConversationSchema() {
  const db = getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_email TEXT NOT NULL,
      title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      summary_json TEXT, summary_message_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, provider TEXT, model TEXT, usage_json TEXT,
      citations_json TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS message_feedback (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL, owner_email TEXT NOT NULL,
      rating INTEGER NOT NULL, comment TEXT, reason TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS conversation_attachments (
      conversation_id TEXT NOT NULL, asset_id TEXT NOT NULL,
      retention TEXT NOT NULL DEFAULT 'temporary',
      created_at TEXT NOT NULL,
      PRIMARY KEY(conversation_id, asset_id),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor_email TEXT NOT NULL,
      action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT,
      trace_id TEXT NOT NULL, outcome TEXT NOT NULL, details_json TEXT, created_at TEXT NOT NULL
    )`),
  ]);
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS conversations_owner_idx ON conversations(tenant_id, owner_email, updated_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS message_feedback_message_idx ON message_feedback(message_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS conversation_attachments_asset_idx ON conversation_attachments(asset_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS audit_logs_tenant_created_idx ON audit_logs(tenant_id, created_at)"),
  ]);
  try {
    const columns = await db.prepare("PRAGMA table_info(conversations)").all<{ name: string }>();
    const columnNames = new Set((columns.results || []).map((column) => column.name));
    const upgrades = [];
    if (!columnNames.has("summary_json")) {
      upgrades.push(db.prepare("ALTER TABLE conversations ADD COLUMN summary_json TEXT"));
    }
    if (!columnNames.has("summary_message_count")) {
      upgrades.push(db.prepare("ALTER TABLE conversations ADD COLUMN summary_message_count INTEGER DEFAULT 0"));
    }
    if (upgrades.length) await db.batch(upgrades);
  } catch {
    // Another request or a managed migration may have completed the additive upgrade.
  }
  try {
    const columns = await db.prepare("PRAGMA table_info(message_feedback)").all<{ name: string }>();
    if (!(columns.results || []).some((column) => column.name === "reason")) {
      await db.prepare("ALTER TABLE message_feedback ADD COLUMN reason TEXT").run();
    }
  } catch { /* additive upgrade may already have completed */ }
  try {
    await db.prepare(`CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content, conversation_id UNINDEXED, role UNINDEXED, created_at UNINDEXED,
      tokenize = 'unicode61'
    )`).run();
  } catch { /* FTS5 may not be available on all D1 versions */ }
  try {
    const cols = await db.prepare("PRAGMA table_info(user_profiles)").all<{ name: string }>();
    const colNames = new Set(((cols.results || []) as Array<{ name: string }>).map((c) => c.name));
    if (!colNames.has("preferences_json")) {
      await db.prepare("ALTER TABLE user_profiles ADD COLUMN preferences_json TEXT DEFAULT '{}'").run();
    }
  } catch { /* table may not exist yet */ }
}

export async function audit(input: {
  principal: Principal;
  action: string;
  resourceType: string;
  resourceId?: string;
  traceId: string;
  outcome?: "success" | "failure" | "denied";
  details?: Record<string, unknown>;
}) {
  await ensureConversationSchema();
  await getD1().prepare(`INSERT INTO audit_logs
    (id, tenant_id, actor_email, action, resource_type, resource_id, trace_id, outcome, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      id("aud"),
      input.principal.tenantId,
      input.principal.email,
      input.action,
      input.resourceType,
      input.resourceId || null,
      input.traceId,
      input.outcome || "success",
      input.details ? JSON.stringify(input.details) : null,
      nowIso(),
    ).run();
}

export async function createConversation(principal: Principal, title = "새 대화") {
  await ensureConversationSchema();
  const conversationId = id("conv");
  const timestamp = nowIso();
  await getD1().prepare(`INSERT INTO conversations
    (id, tenant_id, owner_email, title, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)`).bind(
      conversationId,
      principal.tenantId,
      principal.email,
      title.trim().slice(0, 120) || "새 대화",
      timestamp,
      timestamp,
    ).run();
  return conversationId;
}

export async function assertConversationOwner(principal: Principal, conversationId: string) {
  await ensureConversationSchema();
  const row = await getD1().prepare(`SELECT id FROM conversations
    WHERE id = ? AND tenant_id = ? AND status = 'active'
      AND (owner_email = ? OR ? = 'admin')`).bind(
      conversationId,
      principal.tenantId,
      principal.email,
      principal.role,
    ).first<{ id: string }>();
  if (!row) throw new ConversationError("대화를 찾을 수 없습니다.", 404, "CONVERSATION_NOT_FOUND");
}

export async function getConversation(principal: Principal, conversationId: string) {
  await assertConversationOwner(principal, conversationId);
  const db = getD1();
  const [conversation, messages, sensitivity, attachments] = await Promise.all([
    db.prepare(`SELECT id, title, status, created_at, updated_at
      FROM conversations WHERE id = ?`).bind(conversationId).first(),
    db.prepare(`SELECT id, role, content, provider, model, usage_json, citations_json, created_at,
        (SELECT rating FROM message_feedback f WHERE f.message_id = messages.id AND f.owner_email = ?
          ORDER BY f.created_at DESC LIMIT 1) AS feedback
      FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`).bind(principal.email, conversationId).all(),
    getConversationSensitivity(principal, conversationId),
    listConversationAttachments(principal, conversationId),
  ]);
  const storedMessages = (messages.results || []) as Array<Record<string, unknown>>;
  return {
    ...conversation,
    sensitivity: sensitivity || "internal",
    attachments,
    messages: storedMessages.map((message) => ({
      ...message,
      usage: message.usage_json ? JSON.parse(String(message.usage_json)) : undefined,
      citations: message.citations_json ? JSON.parse(String(message.citations_json)) : [],
      usage_json: undefined,
      citations_json: undefined,
    })),
  };
}

export type ConversationAttachment = {
  asset_id: string;
  title: string;
  mime_type: string;
  status: string;
  segment_count: number;
  retention: "temporary";
  created_at: string;
};

export async function attachConversationAsset(
  principal: Principal,
  conversationId: string,
  assetId: string,
) {
  await assertConversationOwner(principal, conversationId);
  const db = getD1();
  const asset = await db.prepare(`SELECT id FROM assets
    WHERE id = ? AND tenant_id = ? AND owner_email = ? AND deleted_at IS NULL`)
    .bind(assetId, principal.tenantId, principal.email)
    .first<{ id: string }>();
  if (!asset) throw new ConversationError("첨부할 파일을 찾을 수 없습니다.", 404, "ATTACHMENT_ASSET_NOT_FOUND");
  await db.prepare(`INSERT INTO conversation_attachments
    (conversation_id, asset_id, retention, created_at)
    VALUES (?, ?, 'temporary', ?)
    ON CONFLICT(conversation_id, asset_id) DO NOTHING`)
    .bind(conversationId, assetId, nowIso())
    .run();
}

export async function listConversationAttachments(
  principal: Principal,
  conversationId: string,
): Promise<ConversationAttachment[]> {
  await assertConversationOwner(principal, conversationId);
  const rows = await getD1().prepare(`SELECT ca.asset_id, a.title, a.mime_type, a.status,
      a.segment_count, ca.retention, ca.created_at
    FROM conversation_attachments ca
    JOIN assets a ON a.id = ca.asset_id
    WHERE ca.conversation_id = ? AND ca.retention = 'temporary'
      AND a.tenant_id = ? AND a.deleted_at IS NULL
    ORDER BY ca.created_at ASC`)
    .bind(conversationId, principal.tenantId)
    .all<ConversationAttachment>();
  return (rows.results || []) as ConversationAttachment[];
}

export async function getConversationAttachmentAssetIds(
  principal: Principal,
  conversationId: string,
) {
  return (await listConversationAttachments(principal, conversationId))
    .map((attachment) => attachment.asset_id);
}

export async function detachConversationAssets(conversationId: string, assetIds: string[]) {
  if (!assetIds.length) return;
  const db = getD1();
  await db.prepare(`DELETE FROM conversation_attachments
    WHERE conversation_id = ? AND asset_id IN (${assetIds.map(() => "?").join(",")})`)
    .bind(conversationId, ...assetIds)
    .run();
}

export async function listConversations(principal: Principal, limit = 30) {
  await ensureConversationSchema();
  const rows = await getD1().prepare(`SELECT id, title, status, created_at, updated_at
    FROM conversations WHERE tenant_id = ? AND owner_email = ? AND status = 'active'
    ORDER BY updated_at DESC LIMIT ?`).bind(
      principal.tenantId,
      principal.email,
      Math.min(Math.max(limit, 1), 100),
    ).all();
  return rows.results || [];
}

export async function conversationContext(principal: Principal, conversationId: string): Promise<GatewayMessage[]> {
  await assertConversationOwner(principal, conversationId);
  const db = getD1();
  const conv = await db.prepare(`SELECT summary_json, summary_message_count FROM conversations WHERE id = ?`)
    .bind(conversationId).first<{ summary_json: string | null; summary_message_count: number }>();
  let summary = emptySummary();
  try { summary = conv?.summary_json ? parseConversationSummary(JSON.parse(conv.summary_json)) : summary; } catch { /* malformed legacy summary is ignored */ }
  const rows = await db.prepare(`SELECT role, content FROM messages
    WHERE conversation_id = ? AND role IN ('user', 'assistant')
    ORDER BY created_at DESC LIMIT 18`).bind(conversationId).all<{ role: "user" | "assistant"; content: string }>();
  const recent = (rows.results || []).reverse();
  const messages: GatewayMessage[] = [];
  const summaryContext = conversationSummaryContext(summary);
  if (summaryContext) {
    messages.push({ role: "assistant", content: `[이전 대화 메모리]\n${summaryContext}\n이 메모리의 확정 사실·제약을 임의로 바꾸지 말고, 새 질문과 충돌하면 확인 질문을 먼저 하세요.` });
  }
  messages.push(...recent);
  return messages;
}

const SUMMARY_TRIGGER_COUNT = 12;
const SUMMARY_PROTECT_HEAD = 4;
const SUMMARY_PROTECT_TAIL = 4;

export async function maybeSummarizeConversation(principal: Principal, conversationId: string, traceId: string): Promise<void> {
  const db = getD1();
  const conv = await db.prepare(`SELECT summary_json, summary_message_count FROM conversations WHERE id = ? AND status = 'active'`)
    .bind(conversationId).first<{ summary_json: string | null; summary_message_count: number }>();
  if (!conv) return;
  const countRow = await db.prepare(`SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ? AND role IN ('user','assistant')`)
    .bind(conversationId).first<{ cnt: number }>();
  const totalMessages = countRow?.cnt || 0;
  const lastSummarizedAt = conv.summary_message_count || 0;
  const unsummarized = totalMessages - lastSummarizedAt;
  if (unsummarized < SUMMARY_TRIGGER_COUNT) return;

  const compressibleStart = lastSummarizedAt + SUMMARY_PROTECT_HEAD;
  const compressibleEnd = totalMessages - SUMMARY_PROTECT_TAIL;
  if (compressibleEnd <= compressibleStart) return;

  const toSummarize = await db.prepare(`SELECT role, content FROM messages
    WHERE conversation_id = ? AND role IN ('user','assistant')
    ORDER BY created_at ASC LIMIT ? OFFSET ?`).bind(conversationId, compressibleEnd - compressibleStart, compressibleStart).all<{ role: string; content: string }>();
  const toSummarizeRows = toSummarize.results || [];
  if (toSummarizeRows.length < 3) return;

  let priorSummary = emptySummary();
  try { priorSummary = conv.summary_json ? parseConversationSummary(JSON.parse(conv.summary_json)) : priorSummary; } catch { /* malformed legacy summary is ignored */ }
  const conversationText = toSummarizeRows
    .map((m) => `${m.role === "user" ? "사용자" : "AI"}: ${m.content.slice(0, 500)}`)
    .join("\n");
  const prompt = `[CONTEXT SUMMARY] 다음 대화에서 장기 대화에 반드시 보존할 정보만 추출하세요. JSON만 반환하고 설명·마크다운을 추가하지 마세요. 형식은 {"facts":["검증되거나 사용자가 확정한 사실"],"constraints":["사용자 요구 범위·금지 조건·수치"],"decisions":["합의·확정된 결정"],"openQuestions":["아직 확인이 필요한 항목"]} 입니다. AI의 추측은 facts나 decisions에 넣지 마세요. 항목은 각 배열 최대 8개, 각 항목 300자 이내입니다.

${conversationSummaryContext(priorSummary) ? `이전 구조화 메모리:\n${JSON.stringify(priorSummary)}\n\n` : ""}대화:\n${conversationText}

JSON:`;
  try {
    const completion = await completeWithGateway(
      [{ role: "user", content: prompt }],
      traceId,
      { maxOutputTokens: 512, sensitivity: "internal" },
      "swift",
    );
    let structured = emptySummary();
    try {
      structured = parseConversationSummary(JSON.parse(completion.content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()));
    } catch {
      // 모델이 JSON 계약을 지키지 않아도 기존 요약을 버리지 않고, 이번 결과를 사실
      // 후보로 보존한다. 다음 요약 시 정상 JSON으로 다시 정규화된다.
      structured = { ...priorSummary, facts: [...priorSummary.facts, completion.content.trim().slice(0, 1_200)].filter(Boolean).slice(-8) };
    }
    await db.prepare(`UPDATE conversations SET summary_json = ?, summary_message_count = ?, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(structured), compressibleEnd, nowIso(), conversationId).run();
  } catch (error) {
    console.error("[conversations] summarize failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

export async function recordExchange(input: {
  principal: Principal;
  conversationId: string;
  userContent: string;
  completion: GatewayCompletion;
  citations: RagCitation[] | WebRagCitation[];
  deepResearch?: boolean;
}) {
  await assertConversationOwner(input.principal, input.conversationId);
  const userMessageId = id("msg");
  const assistantMessageId = id("msg");
  const timestamp = nowIso();
  const db = getD1();
  await db.batch([
    db.prepare(`INSERT INTO messages
      (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)`)
      .bind(userMessageId, input.conversationId, input.userContent, timestamp),
    db.prepare(`INSERT INTO messages
      (id, conversation_id, role, content, provider, model, usage_json, citations_json, created_at)
      VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)`)
      .bind(
        assistantMessageId,
        input.conversationId,
        input.completion.content,
        input.completion.provider,
        input.completion.model,
        JSON.stringify({ ...(input.completion.usage || {}), deep_research: input.deepResearch === true }),
        JSON.stringify(input.citations),
        timestamp,
      ),
    db.prepare("UPDATE conversations SET title = CASE WHEN title = '새 대화' THEN ? ELSE title END, updated_at = ? WHERE id = ?")
      .bind(input.userContent.slice(0, 60), timestamp, input.conversationId),
  ]);
  try {
    await db.batch([
      db.prepare("INSERT INTO messages_fts (content, conversation_id, role, created_at) VALUES (?, ?, 'user', ?)")
        .bind(input.userContent, input.conversationId, timestamp),
      db.prepare("INSERT INTO messages_fts (content, conversation_id, role, created_at) VALUES (?, ?, 'assistant', ?)")
        .bind(input.completion.content, input.conversationId, timestamp),
    ]);
  } catch { /* FTS5 may not be available */ }
  return { userMessageId, messageId: assistantMessageId };
}

export async function deleteConversation(principal: Principal, conversationId: string) {
  await assertConversationOwner(principal, conversationId);
  await getD1().prepare("UPDATE conversations SET status = 'deleted', updated_at = ? WHERE id = ?")
    .bind(nowIso(), conversationId).run();
}

export type FeedbackReason = "inaccurate" | "insufficient_evidence" | "misunderstood" | "missing_key_point" | "format_mismatch";
const FEEDBACK_REASONS = new Set<FeedbackReason>(["inaccurate", "insufficient_evidence", "misunderstood", "missing_key_point", "format_mismatch"]);

export async function addFeedback(principal: Principal, messageId: string, rating: number, comment?: string, reason?: string) {
  if (![1, -1].includes(rating)) throw new ConversationError("rating은 1 또는 -1이어야 합니다.", 400, "INVALID_FEEDBACK");
  if (reason !== undefined && !FEEDBACK_REASONS.has(reason as FeedbackReason)) throw new ConversationError("유효한 개선 사유를 선택해 주세요.", 400, "INVALID_FEEDBACK_REASON");
  await ensureConversationSchema();
  const message = await getD1().prepare(`SELECT m.id FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = ? AND c.tenant_id = ? AND c.owner_email = ? AND c.status = 'active'`).bind(
      messageId,
      principal.tenantId,
      principal.email,
    ).first();
  if (!message) throw new ConversationError("피드백 대상 메시지를 찾을 수 없습니다.", 404, "MESSAGE_NOT_FOUND");
  const feedbackId = id("fb");
  await getD1().prepare(`INSERT INTO message_feedback
    (id, message_id, owner_email, rating, comment, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
      feedbackId,
      messageId,
      principal.email,
      rating,
      comment?.trim().slice(0, 1000) || null,
      reason || null,
      nowIso(),
    ).run();
  return feedbackId;
}

export interface SessionSearchResult {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  role: string;
  snippet: string;
  createdAt: string;
}

function sanitizeFts5Query(query: string): string {
  let sanitized = query.slice(0, 500);
  sanitized = sanitized.replace(/[+{}():^~]/g, " ");
  sanitized = sanitized.replace(/\*+/g, "*");
  sanitized = sanitized.replace(/(^|\s)\*/g, "$1");
  sanitized = sanitized.replace(/^(AND|OR|NOT)\b\s*/i, "");
  sanitized = sanitized.replace(/\s+(AND|OR|NOT)\s*$/i, "");
  return sanitized.trim();
}

export async function searchConversations(principal: Principal, query: string, limit = 20): Promise<SessionSearchResult[]> {
  await ensureConversationSchema();
  const sanitized = sanitizeFts5Query(query);
  if (!sanitized) return [];
  const db = getD1();
  try {
    const rows = await db.prepare(`
      SELECT m.id, m.conversation_id, m.role, m.created_at,
        snippet(messages_fts, 0, '>>>', '<<<', '...', 40) as snippet,
        c.title as conversation_title
      FROM messages_fts
      JOIN messages m ON m.content = messages_fts.content AND m.conversation_id = messages_fts.conversation_id
      JOIN conversations c ON c.id = m.conversation_id
      WHERE messages_fts MATCH ?
        AND c.tenant_id = ? AND c.owner_email = ? AND c.status = 'active'
        AND m.role IN ('user', 'assistant')
      ORDER BY rank
      LIMIT ?`).bind(sanitized, principal.tenantId, principal.email, Math.min(limit, 50)).all<{
        id: string; conversation_id: string; role: string; created_at: string;
        snippet: string; conversation_title: string;
      }>();
    return (rows.results || []).map((row) => ({
      messageId: row.id,
      conversationId: row.conversation_id,
      conversationTitle: row.conversation_title,
      role: row.role,
      snippet: row.snippet,
      createdAt: row.created_at,
    }));
  } catch {
    const likePattern = `%${query.replace(/[%_]/g, (m) => "\\" + m)}%`;
    const rows = await db.prepare(`
      SELECT m.id, m.conversation_id, m.role, m.created_at,
        substr(m.content, max(1, instr(m.content, ?) - 40), 120) as snippet,
        c.title as conversation_title
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.content LIKE ? ESCAPE '\'
        AND c.tenant_id = ? AND c.owner_email = ? AND c.status = 'active'
        AND m.role IN ('user', 'assistant')
      ORDER BY m.created_at DESC LIMIT ?`).bind(
        query.slice(0, 100), likePattern, principal.tenantId, principal.email, Math.min(limit, 50)
      ).all<{
        id: string; conversation_id: string; role: string; created_at: string;
        snippet: string; conversation_title: string;
      }>();
    return (rows.results || []).map((row) => ({
      messageId: row.id,
      conversationId: row.conversation_id,
      conversationTitle: row.conversation_title,
      role: row.role,
      snippet: row.snippet,
      createdAt: row.created_at,
    }));
  }
}
