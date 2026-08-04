ALTER TABLE `retrieval_traces` ADD `query_variant_count` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `retrieval_traces` ADD `fusion_strategy` text DEFAULT 'weighted' NOT NULL;
--> statement-breakpoint
ALTER TABLE `retrieval_traces` ADD `fusion_candidate_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `retrieval_traces` ADD `rerank_candidate_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `retrieval_traces` ADD `evidence_confidence` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `retrieval_traces` ADD `verifier_status` text DEFAULT 'not_evaluated' NOT NULL;
