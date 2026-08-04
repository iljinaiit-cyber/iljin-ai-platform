CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`owner_email` text NOT NULL,
	`title` text NOT NULL,
	`objective` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`current_state` text DEFAULT 'router' NOT NULL,
	`selected_tool_id` text,
	`max_iterations` integer DEFAULT 5 NOT NULL,
	`iteration_count` integer DEFAULT 0 NOT NULL,
	`idempotency_key` text NOT NULL,
	`input_json` text,
	`output_json` text,
	`error_code` text,
	`error_message` text,
	`trace_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`selected_tool_id`) REFERENCES `tool_registry`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_owner_idempotency_uidx` ON `agent_runs` (`tenant_id`,`owner_email`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_runs_owner_created_idx` ON `agent_runs` (`tenant_id`,`owner_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_runs_status_updated_idx` ON `agent_runs` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `agent_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`step_type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`tool_id` text,
	`trace_id` text NOT NULL,
	`input_json` text,
	`output_json` text,
	`error_code` text,
	`error_message` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tool_id`) REFERENCES `tool_registry`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_steps_run_sequence_uidx` ON `agent_steps` (`run_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `agent_steps_run_status_idx` ON `agent_steps` (`run_id`,`status`);--> statement-breakpoint
CREATE TABLE `tool_approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`tool_id` text NOT NULL,
	`requester_email` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`decision_by` text,
	`decision_note` text,
	`decided_at` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `agent_steps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tool_id`) REFERENCES `tool_registry`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tool_approval_requests_run_step_uidx` ON `tool_approval_requests` (`run_id`,`step_id`);--> statement-breakpoint
CREATE INDEX `tool_approval_requests_status_expires_idx` ON `tool_approval_requests` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `tool_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`tool_id` text NOT NULL,
	`approval_request_id` text,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`output_json` text,
	`error_code` text,
	`error_message` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `agent_steps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tool_id`) REFERENCES `tool_registry`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approval_request_id`) REFERENCES `tool_approval_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tool_executions_idempotency_uidx` ON `tool_executions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `tool_executions_run_status_idx` ON `tool_executions` (`run_id`,`status`);--> statement-breakpoint
CREATE TABLE `tool_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT '*' NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`risk_level` text DEFAULT 'R0' NOT NULL,
	`mode` text DEFAULT 'read_only' NOT NULL,
	`adapter_type` text DEFAULT 'builtin' NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`timeout_ms` integer DEFAULT 3000 NOT NULL,
	`max_retries` integer DEFAULT 0 NOT NULL,
	`input_schema_json` text DEFAULT '{}' NOT NULL,
	`required_roles_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tool_registry_enabled_risk_idx` ON `tool_registry` (`enabled`,`risk_level`);--> statement-breakpoint
CREATE INDEX `tool_registry_adapter_idx` ON `tool_registry` (`adapter_type`);