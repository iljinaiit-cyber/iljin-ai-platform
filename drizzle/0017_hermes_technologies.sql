-- FTS5 virtual table for session search
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content, conversation_id UNINDEXED, role UNINDEXED, created_at UNINDEXED,
  tokenize = 'unicode61'
);

-- Context files for department/role-based context injection
CREATE TABLE IF NOT EXISTS context_files (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, department TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '*', filename TEXT NOT NULL, content TEXT NOT NULL,
  priority INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS context_files_tenant_dept_idx ON context_files(tenant_id, department, role, enabled);

-- Agent skills table
CREATE TABLE IF NOT EXISTS agent_skills (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_email TEXT NOT NULL,
  name TEXT NOT NULL, trigger_patterns_json TEXT NOT NULL DEFAULT '[]',
  steps_json TEXT NOT NULL DEFAULT '[]', evidence_requirements TEXT,
  success_count INTEGER DEFAULT 0, failure_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft', conversation_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_skills_tenant_owner_idx ON agent_skills(tenant_id, owner_email, status);
CREATE INDEX IF NOT EXISTS agent_skills_tenant_status_idx ON agent_skills(tenant_id, status);

-- Scheduled tasks table
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_email TEXT NOT NULL,
  prompt TEXT NOT NULL, cron_expression TEXT NOT NULL,
  last_run_at TEXT, next_run_at TEXT NOT NULL,
  enabled INTEGER DEFAULT 1, last_result TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scheduled_tasks_tenant_owner_idx ON scheduled_tasks(tenant_id, owner_email, enabled);
CREATE INDEX IF NOT EXISTS scheduled_tasks_next_run_idx ON scheduled_tasks(next_run_at, enabled);
