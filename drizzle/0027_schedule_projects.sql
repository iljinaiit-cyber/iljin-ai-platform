CREATE TABLE IF NOT EXISTS schedule_projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  owner_email TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  color TEXT NOT NULL DEFAULT 'blue',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS schedule_projects_owner_status_idx ON schedule_projects(tenant_id, owner_email, status, updated_at);
