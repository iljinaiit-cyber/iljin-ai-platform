CREATE TABLE IF NOT EXISTS `chat_agents` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `owner_email` text NOT NULL,
  `name` text NOT NULL,
  `instructions` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chat_agents_owner_updated_idx`
  ON `chat_agents` (`tenant_id`,`owner_email`,`updated_at`);
