ALTER TABLE `assets` ADD `original_size` integer;
--> statement-breakpoint
ALTER TABLE `assets` ADD `original_etag` text;
--> statement-breakpoint
ALTER TABLE `assets` ADD `original_uploaded_at` text;
--> statement-breakpoint
ALTER TABLE `assets` ADD `embedding_model` text;
--> statement-breakpoint
ALTER TABLE `assets` ADD `embedding_dimensions` integer;
--> statement-breakpoint
ALTER TABLE `retrieval_traces` ADD `embedding_model` text;
--> statement-breakpoint
ALTER TABLE `retrieval_traces` ADD `embedding_dimensions` integer;
--> statement-breakpoint
ALTER TABLE `retrieval_traces` ADD `rerank_model` text;
--> statement-breakpoint
ALTER TABLE `retrieval_traces` ADD `rerank_status` text DEFAULT 'not_configured' NOT NULL;
--> statement-breakpoint
ALTER TABLE `retrieval_traces` ADD `candidate_count` integer DEFAULT 0 NOT NULL;
