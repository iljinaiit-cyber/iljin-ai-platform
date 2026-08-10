CREATE TABLE IF NOT EXISTS schedule_work_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  owner_email TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'todo',
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  due_at TEXT,
  reminder_at TEXT,
  source_type TEXT,
  source_id TEXT,
  parent_id TEXT,
  auto_generated INTEGER NOT NULL DEFAULT 0,
  notify_enabled INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  work_item_id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  delivered_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS schedule_work_items_tenant_status_idx
  ON schedule_work_items(tenant_id, owner_email, status, due_at);
CREATE INDEX IF NOT EXISTS schedule_work_items_source_idx
  ON schedule_work_items(tenant_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS schedule_notifications_due_idx
  ON schedule_notifications(tenant_id, owner_email, scheduled_at, delivered_at);
