ALTER TABLE `segments` ADD `vector_indexed_at` text;
CREATE INDEX IF NOT EXISTS `segments_vector_indexed_idx` ON `segments` (`vector_indexed_at`);
