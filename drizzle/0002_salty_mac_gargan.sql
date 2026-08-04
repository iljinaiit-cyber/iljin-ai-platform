ALTER TABLE `user_profiles` ADD `approval_requested_at` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `approved_by` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `approved_at` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `rejection_reason` text;--> statement-breakpoint
CREATE INDEX `user_profiles_status_requested_idx` ON `user_profiles` (`status`,`approval_requested_at`);