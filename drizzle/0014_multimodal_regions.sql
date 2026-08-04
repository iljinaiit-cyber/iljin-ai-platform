CREATE TABLE IF NOT EXISTS `visual_regions` (
  `id` text PRIMARY KEY NOT NULL,
  `asset_id` text NOT NULL,
  `segment_id` text,
  `page_number` integer DEFAULT 1 NOT NULL,
  `region_type` text DEFAULT 'image' NOT NULL,
  `ordinal` integer DEFAULT 0 NOT NULL,
  `bbox_json` text DEFAULT '[0,0,1,1]' NOT NULL,
  `caption` text,
  `ocr_text` text,
  `table_markdown` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS `visual_regions_asset_idx` ON `visual_regions` (`asset_id`, `page_number`);
CREATE INDEX IF NOT EXISTS `visual_regions_segment_idx` ON `visual_regions` (`segment_id`);
