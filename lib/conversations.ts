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
      rating INTEGER NOT NULL, comment TEXT, created_at TEXT NOT NULL,
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
    db.prepare(`SELECT id, role, content, provider, model, usage_json, citations_json, created_at
      FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`).bind(conversationId).all(),
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
  const summary = conv?.summary_json ? JSON.parse(conv.summary_json) as string : null;
  const rows = await db.prepare(`SELECT role, content FROM messages
    WHERE conversation_id = ? AND role IN ('user', 'assistant')
    ORDER BY created_at DESC LIMIT 18`).bind(conversationId).all<{ role: "user" | "assistant"; content: string }>();
  const recent = (rows.results || []).reverse();
  const messages: GatewayMessage[] = [];
  if (summary) {
    messages.push({ role: "assistant", content: `[이전 대화 요약] ${summary}` });
  }
  messages.push(...recent);
  return messages;
}

const SUMMARY_TRIGGER_COUNT = 12;
const SUMMARY_KEEP_RECENT = 6;
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

  const priorSummary = conv.summary_json ? JSON.parse(conv.summary_json) as string : "";
  const conversationText = toSummarizeRows
    .map((m) => `${m.role === "user" ? "사용자" : "AI"}: ${m.content.slice(0, 500)}`)
    .join("\n");
  const prompt = `[CONTEXT SUMMARY] 다음 대화의 핵심 사실, 결정된 사항, 사용자의 의도를 3~5문장으로 요약하세요. 이전 요약이 있으면 통합하세요. 정보 손실 없이 핵심만 간결하게 작성하세요.

${priorSummary ? `이전 요약:\n${priorSummary}\n\n` : ""}대화:\n${conversationText}

요약:`;
  try {
    const completion = await completeWithGateway(
      [{ role: "user", content: prompt }],
      traceId,
      { maxOutputTokens: 512, sensitivity: "internal" },
      "swift",
    );
    await db.prepare(`UPDATE conversations SET summary_json = ?, summary_message_count = ?, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(completion.content), compressibleEnd, nowIso(), conversationId).run();
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
        JSON.stringify(input.completion.usage || {}),
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

export async function addFeedback(principal: Principal, messageId: string, rating: number, comment?: string) {
  if (![1, -1].includes(rating)) throw new ConversationError("rating은 1 또는 -1이어야 합니다.", 400, "INVALID_FEEDBACK");
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
    (id, message_id, owner_email, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(
      feedbackId,
      messageId,
      principal.email,
      rating,
      comment?.trim().slice(0, 1000) || null,
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
