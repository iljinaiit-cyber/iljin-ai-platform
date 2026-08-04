ALTER TABLE `retrieval_traces` ADD `search_scope` text DEFAULT 'internal' NOT NULL;
--> statement-breakpoint
ALTER TABLE `retrieval_traces` ADD `search_provider` text;
