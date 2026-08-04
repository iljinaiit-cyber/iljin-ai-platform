CREATE TABLE `role_permissions` (
  `tenant_id` text NOT NULL,
  `role` text NOT NULL,
  `permission_key` text NOT NULL,
  `allowed` integer NOT NULL,
  `updated_by` text NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`tenant_id`, `role`, `permission_key`)
);
--> statement-breakpoint
CREATE TABLE `user_permission_overrides` (
  `tenant_id` text NOT NULL,
  `email` text NOT NULL,
  `permission_key` text NOT NULL,
  `allowed` integer NOT NULL,
  `updated_by` text NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`tenant_id`, `email`, `permission_key`),
  FOREIGN KEY (`email`) REFERENCES `user_profiles`(`email`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_permission_overrides_email_idx` ON `user_permission_overrides` (`tenant_id`,`email`);
--> statement-breakpoint
CREATE TABLE `feature_settings` (
  `tenant_id` text NOT NULL,
  `feature_key` text NOT NULL,
  `enabled` integer NOT NULL,
  `config_json` text DEFAULT '{}' NOT NULL,
  `updated_by` text NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`tenant_id`, `feature_key`)
);
--> statement-breakpoint
CREATE INDEX `feature_settings_tenant_idx` ON `feature_settings` (`tenant_id`,`feature_key`);
