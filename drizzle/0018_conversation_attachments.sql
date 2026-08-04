CREATE TABLE `conversation_attachments` (
	`conversation_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`retention` text DEFAULT 'temporary' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`conversation_id`, `asset_id`),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conversation_attachments_asset_idx` ON `conversation_attachments` (`asset_id`);
