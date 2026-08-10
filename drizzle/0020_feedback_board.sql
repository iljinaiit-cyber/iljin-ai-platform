CREATE TABLE IF NOT EXISTS feedback_posts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  author_email TEXT NOT NULL,
  author_display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS feedback_posts_tenant_created_idx
  ON feedback_posts (tenant_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS feedback_posts_tenant_category_idx
  ON feedback_posts (tenant_id, category, created_at);
