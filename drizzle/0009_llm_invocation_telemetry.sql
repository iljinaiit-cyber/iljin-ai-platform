CREATE TABLE IF NOT EXISTS `llm_invocations` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `owner_email` text NOT NULL,
  `conversation_id` text,
  `trace_id` text NOT NULL,
  `provider` text NOT NULL,
  `model` text NOT NULL,
  `sensitivity` text DEFAULT 'internal' NOT NULL,
  `fallback_used` integer DEFAULT 0 NOT NULL,
  `fallback_path_json` text DEFAULT '[]' NOT NULL,
  `prompt_tokens` integer DEFAULT 0 NOT NULL,
  `completion_tokens` integer DEFAULT 0 NOT NULL,
  `total_tokens` integer DEFAULT 0 NOT NULL,
  `latency_ms` integer NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `llm_invocations_trace_uidx` ON `llm_invocations` (`tenant_id`,`trace_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `llm_invocations_tenant_created_idx` ON `llm_invocations` (`tenant_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `llm_invocations_provider_created_idx` ON `llm_invocations` (`tenant_id`,`provider`,`created_at`);
