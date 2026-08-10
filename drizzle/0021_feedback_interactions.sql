ALTER TABLE feedback_posts ADD COLUMN is_notice INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS feedback_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  author_email TEXT NOT NULL,
  author_display_name TEXT NOT NULL,
  author_department TEXT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS feedback_comments_post_created_idx
  ON feedback_comments (post_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS feedback_likes (
  post_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_email)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS feedback_likes_tenant_post_idx
  ON feedback_likes (tenant_id, post_id);
