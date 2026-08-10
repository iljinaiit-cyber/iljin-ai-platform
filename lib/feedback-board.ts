import { getD1 } from "../db";
import { AuthError, requireRole, type Principal } from "./identity";

export type FeedbackCategory = "feature" | "bug" | "question" | "other" | "notice";
export type FeedbackStatus = "received" | "reviewing" | "resolved";

export type FeedbackComment = {
  id: string;
  postId: string;
  content: string;
  authorName: string;
  authorDepartment?: string;
  isMine: boolean;
  createdAt: string;
};

export type FeedbackPost = {
  id: string;
  category: FeedbackCategory;
  title: string;
  content: string;
  isNotice: boolean;
  status: FeedbackStatus;
  authorName: string;
  authorDepartment?: string;
  isMine: boolean;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
  comments: FeedbackComment[];
};

type FeedbackRow = {
  id: string;
  category: FeedbackCategory;
  title: string;
  content: string;
  is_notice: number;
  status: FeedbackStatus;
  author_email: string;
  author_display_name: string;
  author_department: string | null;
  created_at: string;
  like_count: number | string;
  liked_by_me: number;
  comment_count: number | string;
};

type CommentRow = {
  id: string;
  post_id: string;
  content: string;
  author_email: string;
  author_display_name: string;
  author_department: string | null;
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
          content TEXT NOT NULL, is_notice INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'received', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS feedback_comments (
          id TEXT PRIMARY KEY, post_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
          author_email TEXT NOT NULL, author_display_name TEXT NOT NULL,
          author_department TEXT, content TEXT NOT NULL, created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS feedback_likes (
          post_id TEXT NOT NULL, tenant_id TEXT NOT NULL, user_email TEXT NOT NULL,
          created_at TEXT NOT NULL, PRIMARY KEY (post_id, user_email)
        )`),
        db.prepare("CREATE INDEX IF NOT EXISTS feedback_posts_tenant_created_idx ON feedback_posts(tenant_id, created_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS feedback_posts_tenant_category_idx ON feedback_posts(tenant_id, category, created_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS feedback_comments_post_created_idx ON feedback_comments(post_id, created_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS feedback_likes_tenant_post_idx ON feedback_likes(tenant_id, post_id)"),
      ]);
      const columns = await db.prepare("PRAGMA table_info(feedback_posts)").all<{ name: string }>();
      if (!(columns.results || []).some((column) => column.name === "is_notice")) {
        await db.prepare("ALTER TABLE feedback_posts ADD COLUMN is_notice INTEGER NOT NULL DEFAULT 0").run();
      }
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

function assertCategory(value: unknown): asserts value is FeedbackCategory {
  if (value !== "feature" && value !== "bug" && value !== "question" && value !== "other" && value !== "notice") {
    throw new AuthError("유효한 게시판 분류를 선택해 주세요.", 400, "AUTH_INVALID_INPUT");
  }
}

function assertStatus(value: unknown): asserts value is FeedbackStatus {
  if (value !== "received" && value !== "reviewing" && value !== "resolved") {
    throw new AuthError("유효한 게시글 상태를 선택해 주세요.", 400, "AUTH_INVALID_INPUT");
  }
}

function mapComment(row: CommentRow, email: string): FeedbackComment {
  return {
    id: row.id,
    postId: row.post_id,
    content: row.content,
    authorName: row.author_display_name,
    authorDepartment: row.author_department || undefined,
    isMine: row.author_email === email,
    createdAt: row.created_at,
  };
}

function mapPost(row: FeedbackRow, email: string, comments: FeedbackComment[]): FeedbackPost {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    content: row.content,
    isNotice: Boolean(row.is_notice),
    status: row.status,
    authorName: row.author_display_name,
    authorDepartment: row.author_department || undefined,
    isMine: row.author_email === email,
    createdAt: row.created_at,
    likeCount: Number(row.like_count || 0),
    likedByMe: Boolean(row.liked_by_me),
    commentCount: Number(row.comment_count || 0),
    comments,
  };
}

export async function listFeedbackPosts(principal: Principal, category?: string) {
  await ensureFeedbackSchema();
  const db = getD1();
  const categoryFilter = category && ["feature", "bug", "question", "other", "notice"].includes(category)
    ? category
    : undefined;
  const whereCategory = categoryFilter ? " AND f.category = ?" : "";
  const params: unknown[] = [principal.email, principal.tenantId];
  if (categoryFilter) params.push(categoryFilter);
  const rows = await db.prepare(`SELECT f.id, f.category, f.title, f.content, f.is_notice, f.status,
      f.author_email, f.author_display_name, COALESCE(u.department, '') AS author_department, f.created_at,
      (SELECT COUNT(*) FROM feedback_likes l WHERE l.post_id = f.id AND l.tenant_id = f.tenant_id) AS like_count,
      EXISTS(SELECT 1 FROM feedback_likes l WHERE l.post_id = f.id AND l.tenant_id = f.tenant_id AND l.user_email = ?) AS liked_by_me,
      (SELECT COUNT(*) FROM feedback_comments c WHERE c.post_id = f.id AND c.tenant_id = f.tenant_id) AS comment_count
    FROM feedback_posts f
    LEFT JOIN user_profiles u ON u.tenant_id = f.tenant_id AND u.email = f.author_email
    WHERE f.tenant_id = ?${whereCategory}
    ORDER BY f.is_notice DESC, f.created_at DESC LIMIT 200`).bind(...params).all<FeedbackRow>();
  const postRows = rows.results || [];
  if (postRows.length === 0) return [];
  const placeholders = postRows.map(() => "?").join(",");
  const comments = await db.prepare(`SELECT id, post_id, content, author_email, author_display_name, author_department, created_at
    FROM feedback_comments WHERE tenant_id = ? AND post_id IN (${placeholders}) ORDER BY created_at ASC`)
    .bind(principal.tenantId, ...postRows.map((row) => row.id)).all<CommentRow>();
  const commentsByPost = new Map<string, FeedbackComment[]>();
  for (const row of comments.results || []) {
    const list = commentsByPost.get(row.post_id) || [];
    list.push(mapComment(row, principal.email));
    commentsByPost.set(row.post_id, list);
  }
  return postRows.map((row) => mapPost(row, principal.email, commentsByPost.get(row.id) || []));
}

export async function createFeedbackPost(principal: Principal, input: { category?: unknown; title?: unknown; content?: unknown; isNotice?: unknown }) {
  await ensureFeedbackSchema();
  assertCategory(input.category);
  const isNotice = input.category === "notice" || input.isNotice === true;
  if (isNotice) requireRole(principal, ["admin"]);
  if (isNotice && input.category !== "notice") {
    throw new AuthError("공지 게시글은 공지 분류로 등록해 주세요.", 400, "AUTH_INVALID_INPUT");
  }
  const title = String(input.title || "").trim().slice(0, 120);
  const content = String(input.content || "").trim().slice(0, 5000);
  if (!title || !content) throw new AuthError("제목과 내용을 입력해 주세요.", 400, "AUTH_INVALID_INPUT");
  const id = "fbp_" + crypto.randomUUID().replaceAll("-", "");
  const timestamp = new Date().toISOString();
  await getD1().prepare(`INSERT INTO feedback_posts
    (id, tenant_id, author_email, author_display_name, category, title, content, is_notice, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)`).bind(
      id, principal.tenantId, principal.email, principal.displayName, input.category, title, content, isNotice ? 1 : 0, timestamp, timestamp,
    ).run();
  return {
    id, category: input.category, title, content, isNotice, status: "received" as const,
    authorName: principal.displayName, authorDepartment: principal.department, isMine: true, createdAt: timestamp,
    likeCount: 0, likedByMe: false, commentCount: 0, comments: [],
  } satisfies FeedbackPost;
}

async function assertPost(principal: Principal, postId: string) {
  const post = await getD1().prepare("SELECT id FROM feedback_posts WHERE id = ? AND tenant_id = ?")
    .bind(postId, principal.tenantId).first<{ id: string }>();
  if (!post) throw new AuthError("게시글을 찾을 수 없습니다.", 400, "AUTH_INVALID_INPUT");
}

export async function createFeedbackComment(principal: Principal, postId: string, value: unknown) {
  await ensureFeedbackSchema();
  const content = String(value || "").trim().slice(0, 2000);
  if (!content) throw new AuthError("댓글 내용을 입력해 주세요.", 400, "AUTH_INVALID_INPUT");
  await assertPost(principal, postId);
  const id = "fbc_" + crypto.randomUUID().replaceAll("-", "");
  const timestamp = new Date().toISOString();
  await getD1().prepare(`INSERT INTO feedback_comments
    (id, post_id, tenant_id, author_email, author_display_name, author_department, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      id, postId, principal.tenantId, principal.email, principal.displayName, principal.department, content, timestamp, timestamp,
    ).run();
  return { id, postId, content, authorName: principal.displayName, authorDepartment: principal.department, isMine: true, createdAt: timestamp };
}

export async function toggleFeedbackLike(principal: Principal, postId: string) {
  await ensureFeedbackSchema();
  await assertPost(principal, postId);
  const db = getD1();
  const existing = await db.prepare("SELECT post_id FROM feedback_likes WHERE post_id = ? AND tenant_id = ? AND user_email = ?")
    .bind(postId, principal.tenantId, principal.email).first<{ post_id: string }>();
  if (existing) {
    await db.prepare("DELETE FROM feedback_likes WHERE post_id = ? AND tenant_id = ? AND user_email = ?")
      .bind(postId, principal.tenantId, principal.email).run();
  } else {
    await db.prepare("INSERT INTO feedback_likes (post_id, tenant_id, user_email, created_at) VALUES (?, ?, ?, ?)")
      .bind(postId, principal.tenantId, principal.email, new Date().toISOString()).run();
  }
  const count = await db.prepare("SELECT COUNT(*) AS count FROM feedback_likes WHERE post_id = ? AND tenant_id = ?")
    .bind(postId, principal.tenantId).first<{ count: number | string }>();
  return { liked: !existing, likeCount: Number(count?.count || 0) };
}

export async function updateFeedbackStatus(principal: Principal, postId: string, value: unknown) {
  await ensureFeedbackSchema();
  requireRole(principal, ["admin", "manager"]);
  assertStatus(value);
  await assertPost(principal, postId);
  await getD1().prepare("UPDATE feedback_posts SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
    .bind(value, new Date().toISOString(), postId, principal.tenantId).run();
  return { id: postId, status: value };
}

export async function updateFeedbackPost(
  principal: Principal,
  postId: string,
  input: { title?: unknown; content?: unknown; category?: unknown; isNotice?: unknown },
) {
  await ensureFeedbackSchema();
  const db = getD1();
  const current = await db.prepare(`SELECT id, author_email, title, content, category, is_notice
    FROM feedback_posts WHERE id = ? AND tenant_id = ?`)
    .bind(postId, principal.tenantId)
    .first<{ id: string; author_email: string; title: string; content: string; category: FeedbackCategory; is_notice: number }>();
  if (!current) throw new AuthError("게시글을 찾을 수 없습니다.", 400, "AUTH_INVALID_INPUT");

  if (current.author_email !== principal.email && principal.role !== "admin") {
    throw new AuthError("작성자 본인 또는 관리자만 게시글을 수정할 수 있습니다.", 403, "AUTH_FORBIDDEN");
  }
  if (input.isNotice !== undefined && typeof input.isNotice !== "boolean") {
    throw new AuthError("공지 여부 값이 올바르지 않습니다.", 400, "AUTH_INVALID_INPUT");
  }
  const currentIsNotice = Boolean(current.is_notice);
  const nextIsNotice = input.isNotice === undefined ? currentIsNotice : input.isNotice;
  if (input.isNotice !== undefined && principal.role !== "admin") {
    throw new AuthError("공지 지정과 해제는 관리자만 할 수 있습니다.", 403, "AUTH_FORBIDDEN");
  }

  const title = input.title === undefined ? current.title : String(input.title || "").trim().slice(0, 120);
  const content = input.content === undefined ? current.content : String(input.content || "").trim().slice(0, 5000);
  if (!title || !content) throw new AuthError("제목과 내용을 입력해 주세요.", 400, "AUTH_INVALID_INPUT");

  let category = input.category === undefined ? current.category : input.category;
  if (input.category !== undefined) assertCategory(category);
  if (nextIsNotice) {
    category = "notice";
  } else if (category === "notice") {
    category = "other";
  }

  const timestamp = new Date().toISOString();
  await db.prepare(`UPDATE feedback_posts
    SET title = ?, content = ?, category = ?, is_notice = ?, updated_at = ?
    WHERE id = ? AND tenant_id = ?`)
    .bind(title, content, category, nextIsNotice ? 1 : 0, timestamp, postId, principal.tenantId)
    .run();
  return { id: postId, title, content, category, isNotice: nextIsNotice };
}
