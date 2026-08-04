-- Add summary memory columns to conversations
ALTER TABLE conversations ADD COLUMN summary_json TEXT;
ALTER TABLE conversations ADD COLUMN summary_message_count INTEGER DEFAULT 0;

-- Add preferences column to user_profiles
ALTER TABLE user_profiles ADD COLUMN preferences_json TEXT DEFAULT '{}';

-- Create user_memory table for cross-conversation memory
CREATE TABLE IF NOT EXISTS user_memory (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'fact',
  embedding TEXT,
  conversation_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS user_memory_email_idx ON user_memory(tenant_id, email, created_at);
