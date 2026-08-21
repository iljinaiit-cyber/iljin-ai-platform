ALTER TABLE `visual_regions` ADD COLUMN `chart_json` text;

CREATE TABLE IF NOT EXISTS `visual_embeddings` (
  `id` text PRIMARY KEY NOT NULL,
  `asset_id` text NOT NULL,
  `segment_id` text NOT NULL,
  `embedding` text NOT NULL,
  `embedding_model` text NOT NULL,
  `dimensions` integer NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS `visual_embeddings_asset_idx` ON `visual_embeddings` (`asset_id`);
CREATE INDEX IF NOT EXISTS `visual_embeddings_segment_idx` ON `visual_embeddings` (`segment_id`);
