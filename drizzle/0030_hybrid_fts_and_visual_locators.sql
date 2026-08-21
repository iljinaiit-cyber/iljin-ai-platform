-- Candidate recall: maintain a lexical path alongside dense/vector retrieval.
CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
  heading,
  content,
  content='segments',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO segments_fts(segments_fts) VALUES ('rebuild');

CREATE TRIGGER IF NOT EXISTS segments_fts_ai AFTER INSERT ON segments BEGIN
  INSERT INTO segments_fts(rowid, heading, content) VALUES (new.rowid, new.heading, new.content);
END;
CREATE TRIGGER IF NOT EXISTS segments_fts_ad AFTER DELETE ON segments BEGIN
  INSERT INTO segments_fts(segments_fts, rowid, heading, content) VALUES ('delete', old.rowid, old.heading, old.content);
END;
CREATE TRIGGER IF NOT EXISTS segments_fts_au AFTER UPDATE OF heading, content ON segments BEGIN
  INSERT INTO segments_fts(segments_fts, rowid, heading, content) VALUES ('delete', old.rowid, old.heading, old.content);
  INSERT INTO segments_fts(rowid, heading, content) VALUES (new.rowid, new.heading, new.content);
END;

-- Citation locators preserve the extracted source range used to associate a visual
-- region with the overlapping text chunk. Existing regions are intentionally NULL.
ALTER TABLE visual_regions ADD COLUMN char_start INTEGER;
ALTER TABLE visual_regions ADD COLUMN char_end INTEGER;
