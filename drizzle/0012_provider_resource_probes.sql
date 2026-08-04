CREATE TABLE IF NOT EXISTS `provider_resource_probes` (
  `tenant_id` text NOT NULL,
  `provider` text NOT NULL,
  `status` text NOT NULL,
  `latency_ms` integer NOT NULL,
  `detail` text NOT NULL,
  `checked_by` text NOT NULL,
  `checked_at` text NOT NULL,
  PRIMARY KEY (`tenant_id`, `provider`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `provider_resource_probes_checked_idx`
ON `provider_resource_probes` (`tenant_id`, `checked_at`);
