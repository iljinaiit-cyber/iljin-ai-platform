ALTER TABLE retrieval_traces ADD COLUMN graph_seed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE retrieval_traces ADD COLUMN graph_candidate_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE retrieval_traces ADD COLUMN graph_boosted_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ontology_relation_evidence (
  tenant_id TEXT NOT NULL,
  src_id TEXT NOT NULL,
  dst_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, src_id, dst_id, segment_id)
);

CREATE INDEX IF NOT EXISTS ontology_relation_evidence_asset_idx
  ON ontology_relation_evidence(tenant_id, asset_id);
CREATE INDEX IF NOT EXISTS ontology_relation_evidence_edge_idx
  ON ontology_relation_evidence(tenant_id, src_id, dst_id);
CREATE INDEX IF NOT EXISTS ontology_mentions_tenant_entity_idx
  ON ontology_mentions(tenant_id, entity_id);
