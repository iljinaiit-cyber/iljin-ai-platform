import { getD1 } from "../db";
import { AuthError, type Principal } from "./identity";

export type FeedbackCategory = "feature" | "bug" | "question" | "other";
export type FeedbackStatus = "received" | "reviewing" | "resolved";

export type FeedbackPost = {
  id: string;
  category: FeedbackCategory;
  title: string;
  content: string;
  status: FeedbackStatus;
  authorName: string;
  isMine: boolean;
  createdAt: string;
};

type FeedbackRow = {
  id: string;
  category: FeedbackCategory;
  title: string;
  content: string;
  status: FeedbackStatus;
  author_email: string;
  author_display_name: string;
  created_at: string;
};

let schemaPromise: Promise<void> | undefined;

export function ensureFeedbackSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = getD1();
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS feedback_posts (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, author_email TEXT NOT NULL,
          author_display_name TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL,
          content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'received',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS feedback_posts_tenant_created_idx ON feedback_posts(tenant_id, created_at)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS feedback_posts_tenant_category_idx ON feedback_posts(tenant_id, category, created_at)`),
      ]);
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

function assertCategory(value: unknown): asserts value is FeedbackCategory {
  if (value !== "feature" && value !== "bug" && value !== "question" && value !== "other") {
    throw new AuthError("올바른 의견 분류를 선택해 주세요.", 400, "AUTH_INVALID_INPUT");
  }
}

function mapPost(row: FeedbackRow, email: string): FeedbackPost {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    content: row.content,
    status: row.status,
    authorName: row.author_display_name,
    isMine: row.author_email === email,
    createdAt: row.created_at,
  };
}

export async function listFeedbackPosts(principal: Principal, category?: string) {
  await ensureFeedbackSchema();
  const db = getD1();
  const query = category
    ? db.prepare(`SELECT id, category, title, content, status, author_email, author_display_name, created_at
      FROM feedback_posts WHERE tenant_id = ? AND category = ? ORDER BY created_at DESC LIMIT 200`).bind(principal.tenantId, category)
    : db.prepare(`SELECT id, category, title, content, status, author_email, author_display_name, created_at
      FROM feedback_posts WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200`).bind(principal.tenantId);
  const result = await query.all<FeedbackRow>();
  return (result.results || []).map((row) => mapPost(row, principal.email));
}

export async function createFeedbackPost(principal: Principal, input: { category?: unknown; title?: unknown; content?: unknown }) {
  await ensureFeedbackSchema();
  assertCategory(input.category);
  const title = String(input.title || "").trim().slice(0, 120);
  const content = String(input.content || "").trim().slice(0, 5000);
  if (!title || !content) throw new AuthError("제목과 내용을 입력해 주세요.", 400, "AUTH_INVALID_INPUT");
  const id = "fbp_" + crypto.randomUUID().replaceAll("-", "");
  const timestamp = new Date().toISOString();
  await getD1().prepare(`INSERT INTO feedback_posts
    (id, tenant_id, author_email, author_display_name, category, title, content, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)`).bind(
      id, principal.tenantId, principal.email, principal.displayName, input.category, title, content, timestamp, timestamp,
    ).run();
  return {
    id,
    category: input.category,
    title,
    content,
    status: "received" as const,
    authorName: principal.displayName,
    isMine: true,
    createdAt: timestamp,
  } satisfies FeedbackPost;
}
