CREATE TABLE IF NOT EXISTS `ai_control_assessments` (
  `tenant_id` text NOT NULL,
  `control_id` text NOT NULL,
  `status` text NOT NULL,
  `owner_email` text,
  `evidence_note` text NOT NULL DEFAULT '',
  `due_date` text,
  `updated_by` text NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY(`tenant_id`, `control_id`)
);
--> statement-breakpoint
ALTER TABLE `retrieval_traces` ADD COLUMN `tenant_id` text NOT NULL DEFAULT 'iljin';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `retrieval_traces_tenant_created_idx`
  ON `retrieval_traces` (`tenant_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_control_assessments_status_idx`
  ON `ai_control_assessments` (`tenant_id`, `status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ai_slo_policies` (
  `tenant_id` text NOT NULL,
  `metric_key` text NOT NULL,
  `target_value` real NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `updated_by` text NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY(`tenant_id`, `metric_key`)
);
