-- Add document lifecycle metadata to assets table
ALTER TABLE assets ADD COLUMN document_status TEXT DEFAULT 'effective';
ALTER TABLE assets ADD COLUMN effective_from TEXT;
ALTER TABLE assets ADD COLUMN effective_to TEXT;

-- Index for filtering effective documents
CREATE INDEX IF NOT EXISTS assets_document_status_idx ON assets(document_status);
CREATE INDEX IF NOT EXISTS assets_effective_from_idx ON assets(effective_from);
