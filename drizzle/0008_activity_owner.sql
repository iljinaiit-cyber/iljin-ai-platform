ALTER TABLE `retrieval_traces` ADD COLUMN `owner_email` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `retrieval_traces_owner_created_idx`
  ON `retrieval_traces` (`tenant_id`, `owner_email`, `created_at`);
