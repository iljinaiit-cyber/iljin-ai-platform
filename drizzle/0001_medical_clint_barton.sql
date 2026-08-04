CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`trace_id` text NOT NULL,
	`outcome` text NOT NULL,
	`details_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_tenant_created_idx` ON `audit_logs` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`owner_email` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `conversations_owner_idx` ON `conversations` (`tenant_id`,`owner_email`,`updated_at`);--> statement-breakpoint
CREATE TABLE `message_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`owner_email` text NOT NULL,
	`rating` integer NOT NULL,
	`comment` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_feedback_message_idx` ON `message_feedback` (`message_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`provider` text,
	`model` text,
	`usage_json` text,
	`citations_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rate_limit_buckets` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`request_count` integer NOT NULL,
	`window_started_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limit_expires_idx` ON `rate_limit_buckets` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`email` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`display_name` text NOT NULL,
	`department` text NOT NULL,
	`groups_json` text DEFAULT '[]' NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_profiles_tenant_department_idx` ON `user_profiles` (`tenant_id`,`department`);--> statement-breakpoint
ALTER TABLE `assets` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `owner_email` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `deleted_at` text;