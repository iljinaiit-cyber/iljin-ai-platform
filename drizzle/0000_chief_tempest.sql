CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'iljin' NOT NULL,
	`title` text NOT NULL,
	`source_type` text DEFAULT 'upload' NOT NULL,
	`mime_type` text DEFAULT 'text/plain' NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`classification` text DEFAULT 'internal' NOT NULL,
	`department_scope` text DEFAULT '*' NOT NULL,
	`storage_key` text,
	`checksum` text,
	`segment_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assets_status_idx` ON `assets` (`status`);--> statement-breakpoint
CREATE INDEX `assets_tenant_class_idx` ON `assets` (`tenant_id`,`classification`);--> statement-breakpoint
CREATE TABLE `index_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`stage` text DEFAULT 'received' NOT NULL,
	`error_code` text,
	`error_message` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `index_jobs_status_idx` ON `index_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `retrieval_traces` (
	`id` text PRIMARY KEY NOT NULL,
	`query_hash` text NOT NULL,
	`department` text NOT NULL,
	`result_count` integer NOT NULL,
	`top_score` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `retrieval_traces_created_idx` ON `retrieval_traces` (`created_at`);--> statement-breakpoint
CREATE TABLE `segments` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`parent_id` text,
	`ordinal` integer NOT NULL,
	`heading` text,
	`content` text NOT NULL,
	`page_number` integer,
	`char_start` integer DEFAULT 0 NOT NULL,
	`char_end` integer DEFAULT 0 NOT NULL,
	`token_count` integer DEFAULT 0 NOT NULL,
	`embedding` text,
	`embedding_model` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `segments_asset_idx` ON `segments` (`asset_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `segments_embedding_model_idx` ON `segments` (`embedding_model`);