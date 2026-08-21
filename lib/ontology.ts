import { getD1 } from "../db";

/**
 * 온톨로지 그래프 (2026-08-06)
 *
 * GraphRAG 를 하되 Microsoft 방식의 "청크마다 LLM 4~6회 호출"은 쓰지 않는다.
 * 실측 뉴런 단가로 계산하면 1,000 문서 색인에 $2,023 이고 임베딩의 495배다.
 * 재색인 때마다 그 비용이 반복된다.
 *
 * 대신 추출을 세 단계로 나눈다.
 *
 *   L1  정규식   문서번호·개정차수·일자·규격 → 비용 0
 *   L2  사전대조 법인·부서·제품·설비·프로젝트 → 비용 0 (조직/마스터 테이블 대조)
 *   L3  LLM      위로 안 잡히는 관계만, 신규·변경 청크 한정 (별도 승인 후 적용)
 *
 * 제조업 사내 문서는 L1·L2 로 대부분 잡힌다. 코드 체계가 이미 정형이라
 * 사전 대조가 LLM 추출보다 정확하고 공짜다. 이 파일은 L1·L2 만 구현한다.
 */

export type EntityKind =
  | "corporation"
  | "department"
  | "document_no"
  | "revision"
  | "standard"
  | "product"
  | "equipment"
  | "project"
  | "date";

export type RelationType =
  | "mentions"        // 문서 → 엔티티
  | "issued_by"       // 문서 → 부서
  | "belongs_to"      // 부서 → 법인
  | "revises"         // 문서 → 이전 개정본
  | "references"      // 문서 → 규격/타 문서
  | "co_occurs";      // 엔티티 ↔ 엔티티 (같은 세그먼트 동시 출현)

export interface OntologyEntity {
  id: string;
  kind: EntityKind;
  canonicalName: string;
  corpId: string | null;
  deptId: string | null;
  mentionCount: number;
}

let ontologySchemaPromise: Promise<void> | undefined;

export function ensureOntologySchema() {
  if (!ontologySchemaPromise) {
    ontologySchemaPromise = (async () => {
      const db = getD1();
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS ontology_entities (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, kind TEXT NOT NULL,
          canonical_name TEXT NOT NULL, normalized_name TEXT NOT NULL,
          corp_id TEXT, dept_id TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS ontology_relations (
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
          src_id TEXT NOT NULL, rel_type TEXT NOT NULL, dst_id TEXT NOT NULL,
          weight INTEGER NOT NULL DEFAULT 1,
          evidence_segment_id TEXT, created_at TEXT NOT NULL,
          FOREIGN KEY (src_id) REFERENCES ontology_entities(id) ON DELETE CASCADE,
          FOREIGN KEY (dst_id) REFERENCES ontology_entities(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS ontology_mentions (
          entity_id TEXT NOT NULL, segment_id TEXT NOT NULL, asset_id TEXT NOT NULL,
          tenant_id TEXT NOT NULL, char_start INTEGER NOT NULL, char_end INTEGER NOT NULL,
          PRIMARY KEY (entity_id, segment_id, char_start),
          FOREIGN KEY (entity_id) REFERENCES ontology_entities(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS ontology_relation_evidence (
          tenant_id TEXT NOT NULL, src_id TEXT NOT NULL, dst_id TEXT NOT NULL,
          asset_id TEXT NOT NULL, segment_id TEXT NOT NULL, created_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, src_id, dst_id, segment_id)
        )`),
        db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS ontology_entities_key_idx ON ontology_entities(tenant_id, kind, normalized_name)"),
        db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS ontology_relations_edge_idx ON ontology_relations(tenant_id, src_id, rel_type, dst_id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS ontology_relations_src_idx ON ontology_relations(src_id, rel_type)"),
        db.prepare("CREATE INDEX IF NOT EXISTS ontology_relations_dst_idx ON ontology_relations(dst_id, rel_type)"),
        db.prepare("CREATE INDEX IF NOT EXISTS ontology_mentions_segment_idx ON ontology_mentions(segment_id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS ontology_mentions_asset_idx ON ontology_mentions(asset_id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS ontology_mentions_tenant_entity_idx ON ontology_mentions(tenant_id, entity_id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS ontology_relation_evidence_asset_idx ON ontology_relation_evidence(tenant_id, asset_id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS ontology_relation_evidence_edge_idx ON ontology_relation_evidence(tenant_id, src_id, dst_id)"),
      ]);
    })().catch((error) => {
      ontologySchemaPromise = undefined;
      throw error;
    });
  }
  return ontologySchemaPromise;
}

// ── L1: 정규식 추출 ─────────────────────────────────────────────────────
//
// 한국어에서 \b 는 동작하지 않는다(\w 가 ASCII 한정). 경계는 명시적으로 쓴다.
// 이 함정은 dlp.ts 에서 이미 한 번 밟았다 — 같은 실수를 반복하지 않는다.

interface PatternRule {
  kind: EntityKind;
  pattern: RegExp;
  /** 매치에서 실제 값으로 쓸 캡처 그룹. 미지정이면 전체 매치. */
  group?: number;
}

const L1_RULES: PatternRule[] = [
  // 사내 문서번호: ILJIN-QA-2026-0421, IJ-PRD-1234 등
  { kind: "document_no", pattern: /(?:[A-Z]{2,6}-){1,3}\d{2,6}(?:-\d{1,4})?/g },
  // 개정차수: Rev.3 / 개정 3차 / R3
  { kind: "revision", pattern: /(?:Rev\.?\s*|개정\s*)(\d{1,2})(?:\s*차)?/gi, group: 1 },
  // 표준·규격: KS D 3698, ISO 9001, IEC 60079-1, ASTM B152
  { kind: "standard", pattern: /(?:KS\s?[A-Z]\s?\d{3,5}|ISO\s?\d{3,5}(?:-\d{1,3})?|IEC\s?\d{4,5}(?:-\d{1,3})?|ASTM\s?[A-Z]\d{2,4})/g },
  // 설비 ID: EQ-1234, LINE-03, #2호기
  { kind: "equipment", pattern: /(?:EQ|LINE|M\/C)-\d{1,4}|\d{1,2}\s?호기/gi },
  // 일자: 2026-08-06, 2026.08.06, 2026년 8월 6일
  { kind: "date", pattern: /\d{4}[-.]\d{1,2}[-.]\d{1,2}|\d{4}년\s?\d{1,2}월\s?\d{1,2}일/g },
];

export interface ExtractedMention {
  kind: EntityKind;
  value: string;
  charStart: number;
  charEnd: number;
}

/** 정규식만으로 잡히는 엔티티. LLM 호출 없음. */
export function extractL1(text: string): ExtractedMention[] {
  const out: ExtractedMention[] = [];
  for (const rule of L1_RULES) {
    // lastIndex 오염을 막으려면 매 호출마다 새 정규식을 만들어야 한다.
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const value = (rule.group ? match[rule.group] : match[0])?.trim();
      if (!value) continue;
      out.push({
        kind: rule.kind,
        value,
        charStart: match.index,
        charEnd: match.index + match[0].length,
      });
      if (match.index === re.lastIndex) re.lastIndex += 1; // 빈 매치 무한루프 방지
    }
  }
  return out;
}

// ── L2: 사전 대조 ───────────────────────────────────────────────────────

export interface DictionaryTerm {
  kind: EntityKind;
  /** 표준 명칭. 별칭이 매치돼도 이 이름으로 정규화한다. */
  canonical: string;
  aliases: string[];
  corpId?: string | null;
  deptId?: string | null;
}

/**
 * 조직 마스터에서 사전을 만든다. 법인·부서는 이미 정규화된 이름을 갖고 있으므로
 * 별도 사전 관리 없이 그대로 쓴다 — 이게 조직 마스터를 먼저 만든 이유다.
 */
export async function buildOrganizationDictionary(tenantId: string): Promise<DictionaryTerm[]> {
  const db = getD1();
  const [corps, depts] = await Promise.all([
    db.prepare("SELECT id, name FROM corporations WHERE tenant_id = ? AND status = 'active'")
      .bind(tenantId).all<{ id: string; name: string }>(),
    db.prepare("SELECT id, corp_id, name FROM departments WHERE tenant_id = ? AND status = 'active'")
      .bind(tenantId).all<{ id: string; corp_id: string; name: string }>(),
  ]);
  const terms: DictionaryTerm[] = [];
  for (const c of corps.results ?? []) {
    terms.push({ kind: "corporation", canonical: c.name, aliases: aliasesFor(c.name), corpId: c.id });
  }
  for (const d of depts.results ?? []) {
    terms.push({ kind: "department", canonical: d.name, aliases: aliasesFor(d.name), corpId: d.corp_id, deptId: d.id });
  }
  return terms;
}

/**
 * "AX전략팀" 과 "AX 전략팀" 은 같은 부서다. 공백 유무만 다른 표기를 별칭으로 넣는다.
 * 자유 텍스트 부서명이 오타로 갈라지던 문제를 여기서 흡수한다.
 */
function aliasesFor(name: string): string[] {
  const compact = name.replace(/\s+/g, "");
  const spaced = name.replace(/([가-힣])([A-Z])/g, "$1 $2");
  return Array.from(new Set([name, compact, spaced])).filter((v) => v !== name);
}

export function extractL2(text: string, dictionary: DictionaryTerm[]): ExtractedMention[] {
  const out: ExtractedMention[] = [];
  for (const term of dictionary) {
    for (const form of [term.canonical, ...term.aliases]) {
      if (form.length < 2) continue;
      let from = 0;
      for (;;) {
        const index = text.indexOf(form, from);
        if (index === -1) break;
        out.push({
          kind: term.kind,
          // 별칭으로 잡혀도 표준 명칭으로 기록한다. 집계 키가 갈라지면 안 된다.
          value: term.canonical,
          charStart: index,
          charEnd: index + form.length,
        });
        from = index + form.length;
      }
    }
  }
  return out;
}

// ── 저장 ────────────────────────────────────────────────────────────────

function normalizeKey(kind: EntityKind, value: string) {
  return `${kind}:${value.toLowerCase().replace(/\s+/g, "")}`;
}

function entityId(tenantId: string, kind: EntityKind, value: string) {
  // 결정적 ID. 같은 엔티티가 재색인 때 새 ID 를 받으면 그래프가 갈라진다.
  return `ent_${tenantId}_${normalizeKey(kind, value).replace(/[^a-z0-9가-힣:_-]/gi, "_")}`.slice(0, 200);
}

/**
 * 한 세그먼트에서 뽑은 멘션을 그래프에 반영한다.
 * 엔티티·멘션·동시출현 관계를 한 배치로 쓴다.
 */
export async function persistMentions(input: {
  tenantId: string;
  assetId: string;
  segmentId: string;
  mentions: ExtractedMention[];
  dictionary?: DictionaryTerm[];
}) {
  if (!input.mentions.length) return { entities: 0, relations: 0 };
  await ensureOntologySchema();
  const db = getD1();
  const now = new Date().toISOString();

  const orgByName = new Map(
    (input.dictionary ?? []).map((t) => [normalizeKey(t.kind, t.canonical), t]),
  );

  const unique = new Map<string, ExtractedMention>();
  for (const m of input.mentions) {
    unique.set(`${normalizeKey(m.kind, m.value)}@${m.charStart}`, m);
  }

  const statements = [];
  const entityIds = new Set<string>();
  for (const m of unique.values()) {
    const id = entityId(input.tenantId, m.kind, m.value);
    const org = orgByName.get(normalizeKey(m.kind, m.value));
    if (!entityIds.has(id)) {
      entityIds.add(id);
      statements.push(db.prepare(`INSERT INTO ontology_entities
        (id, tenant_id, kind, canonical_name, normalized_name, corp_id, dept_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, kind, normalized_name) DO UPDATE SET updated_at = excluded.updated_at`)
        .bind(id, input.tenantId, m.kind, m.value, normalizeKey(m.kind, m.value),
              org?.corpId ?? null, org?.deptId ?? null, now, now));
    }
    statements.push(db.prepare(`INSERT OR IGNORE INTO ontology_mentions
      (entity_id, segment_id, asset_id, tenant_id, char_start, char_end)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, input.segmentId, input.assetId, input.tenantId, m.charStart, m.charEnd));
  }

  // 같은 세그먼트에 함께 나온 엔티티끼리 동시출현 간선을 만든다. 이게 그래프의
  // 실질적인 연결성을 만들어 준다 — LLM 없이도 "이 규격과 이 설비가 같이 언급됨"이
  // 남는다. 조합 폭발을 막으려 세그먼트당 상위 12개로 자른다.
  const ids = Array.from(entityIds).slice(0, 12);
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
      statements.push(db.prepare(`INSERT OR IGNORE INTO ontology_relation_evidence
        (tenant_id, src_id, dst_id, asset_id, segment_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(input.tenantId, a, b, input.assetId, input.segmentId, now));
      statements.push(db.prepare(`INSERT INTO ontology_relations
        (id, tenant_id, src_id, rel_type, dst_id, weight, evidence_segment_id, created_at)
        VALUES (?, ?, ?, 'co_occurs', ?, 1, ?, ?)
        ON CONFLICT(tenant_id, src_id, rel_type, dst_id) DO UPDATE SET
          weight = (SELECT COUNT(*) FROM ontology_relation_evidence evidence
            WHERE evidence.tenant_id = excluded.tenant_id
              AND evidence.src_id = excluded.src_id AND evidence.dst_id = excluded.dst_id)`)
        .bind(`rel_${a}_${b}`.slice(0, 200), input.tenantId, a, b, input.segmentId, now));
    }
  }

  // D1 배치 상한을 넘지 않도록 쪼개 쓴다.
  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50));
  }
  return { entities: entityIds.size, relations: (ids.length * (ids.length - 1)) / 2 };
}

/** 세그먼트 텍스트 하나를 L1+L2 로 훑어 그래프에 반영한다. */
export async function indexSegmentOntology(input: {
  tenantId: string;
  assetId: string;
  segmentId: string;
  text: string;
  dictionary: DictionaryTerm[];
}) {
  const mentions = [...extractL1(input.text), ...extractL2(input.text, input.dictionary)];
  return persistMentions({ ...input, mentions });
}

/**
 * Removes one asset's graph evidence without rebuilding the tenant-wide graph.
 * Relation weights are derived from idempotent per-segment evidence rows.
 */
export async function removeAssetOntology(tenantId: string, assetId: string) {
  await ensureOntologySchema();
  const db = getD1();
  await db.batch([
    db.prepare("DELETE FROM ontology_relation_evidence WHERE tenant_id = ? AND asset_id = ?").bind(tenantId, assetId),
    db.prepare("DELETE FROM ontology_mentions WHERE tenant_id = ? AND asset_id = ?").bind(tenantId, assetId),
  ]);
  await db.prepare(`DELETE FROM ontology_relations
    WHERE tenant_id = ? AND rel_type = 'co_occurs'
      AND NOT EXISTS (SELECT 1 FROM ontology_relation_evidence evidence
        WHERE evidence.tenant_id = ontology_relations.tenant_id
          AND evidence.src_id = ontology_relations.src_id AND evidence.dst_id = ontology_relations.dst_id)`)
    .bind(tenantId).run();
  await db.prepare(`UPDATE ontology_relations SET weight = (
      SELECT COUNT(*) FROM ontology_relation_evidence evidence
      WHERE evidence.tenant_id = ontology_relations.tenant_id
        AND evidence.src_id = ontology_relations.src_id AND evidence.dst_id = ontology_relations.dst_id)
    WHERE tenant_id = ? AND rel_type = 'co_occurs'`).bind(tenantId).run();
  await db.prepare(`DELETE FROM ontology_entities
    WHERE tenant_id = ?
      AND NOT EXISTS (SELECT 1 FROM ontology_mentions m WHERE m.entity_id = ontology_entities.id)
      AND NOT EXISTS (SELECT 1 FROM ontology_relations r WHERE r.src_id = ontology_entities.id OR r.dst_id = ontology_entities.id)`)
    .bind(tenantId).run();
}

// ── 조회 · 순회 ─────────────────────────────────────────────────────────

/**
 * 시작 엔티티에서 N홉 이웃을 찾는다. D1 재귀 CTE 로 처리하므로
 * 별도 그래프 DB 가 필요 없다(운영 D1 에서 3홉 동작 확인, 2026-08-06).
 */
export async function neighbors(input: {
  tenantId: string;
  entityIds: string[];
  maxHops?: number;
  limit?: number;
}) {
  if (!input.entityIds.length) return [];
  await ensureOntologySchema();
  const hops = Math.min(Math.max(input.maxHops ?? 2, 1), 3);
  const limit = Math.min(input.limit ?? 50, 200);
  const placeholders = input.entityIds.map(() => "?").join(",");
  const rows = await getD1().prepare(`
    WITH RECURSIVE walk(id, hop, weight) AS (
      SELECT id, 0, 0 FROM ontology_entities
      WHERE tenant_id = ?1 AND id IN (${placeholders})
      UNION
      SELECT CASE WHEN r.src_id = walk.id THEN r.dst_id ELSE r.src_id END,
             walk.hop + 1, r.weight
      FROM ontology_relations r
      JOIN walk ON (r.src_id = walk.id OR r.dst_id = walk.id)
      WHERE r.tenant_id = ?1 AND walk.hop < ${hops}
    )
    SELECT e.id, e.kind, e.canonical_name, e.corp_id, e.dept_id,
           MIN(walk.hop) AS hop, MAX(walk.weight) AS weight,
           (SELECT COUNT(*) FROM ontology_mentions m WHERE m.entity_id = e.id) AS mention_count
    FROM walk JOIN ontology_entities e ON e.id = walk.id
    -- hop > 0 만으로는 부족하다. 간선이 무방향이라 a→b→a 로 시작 엔티티가
    -- 2홉 "이웃"으로 되돌아온다. 시작점은 명시적으로 뺀다.
    WHERE walk.hop > 0 AND e.id NOT IN (${placeholders})
    GROUP BY e.id
    ORDER BY hop, weight DESC, mention_count DESC
    LIMIT ${limit}
  `).bind(input.tenantId, ...input.entityIds, ...input.entityIds).all<{
    id: string; kind: string; canonical_name: string;
    corp_id: string | null; dept_id: string | null;
    hop: number; weight: number; mention_count: number;
  }>();
  return (rows.results ?? []).map((r) => ({
    id: r.id,
    kind: r.kind as EntityKind,
    canonicalName: r.canonical_name,
    corpId: r.corp_id,
    deptId: r.dept_id,
    hop: Number(r.hop),
    weight: Number(r.weight || 0),
    mentionCount: Number(r.mention_count || 0),
  }));
}

/** 질의문에서 엔티티를 찾아 그래프 진입점으로 쓴다. */
export async function resolveQueryEntities(tenantId: string, query: string) {
  await ensureOntologySchema();
  const dictionary = await buildOrganizationDictionary(tenantId);
  const mentions = [...extractL1(query), ...extractL2(query, dictionary)];
  if (!mentions.length) return [];
  const keys = Array.from(new Set(mentions.map((m) => normalizeKey(m.kind, m.value)))).slice(0, 20);
  const rows = await getD1().prepare(
    `SELECT id, kind, canonical_name FROM ontology_entities
     WHERE tenant_id = ? AND normalized_name IN (SELECT value FROM json_each(?))`,
  ).bind(tenantId, JSON.stringify(keys)).all<{ id: string; kind: string; canonical_name: string }>();
  return (rows.results ?? []).map((r) => ({
    id: r.id, kind: r.kind as EntityKind, canonicalName: r.canonical_name,
  }));
}

/**
 * 하이브리드 검색의 그래프 쪽 절반.
 * 질의 엔티티의 이웃이 언급된 세그먼트를 찾아 벡터 결과에 더한다.
 */
export async function graphRelatedSegments(input: {
  tenantId: string;
  department: string;
  query: string;
  limit?: number;
}) {
  const seeds = await resolveQueryEntities(input.tenantId, input.query);
  if (!seeds.length) return { seeds: [], segments: [] };
  const seedIds = seeds.map((seed) => seed.id);
  const relatedRows = await getD1().prepare(`SELECT DISTINCT
      CASE WHEN evidence.src_id IN (SELECT value FROM json_each(?)) THEN evidence.dst_id ELSE evidence.src_id END AS id
    FROM ontology_relation_evidence evidence
    JOIN segments proof_segment ON proof_segment.id = evidence.segment_id
    JOIN assets proof_asset ON proof_asset.id = proof_segment.asset_id
    WHERE evidence.tenant_id = ?
      AND (evidence.src_id IN (SELECT value FROM json_each(?)) OR evidence.dst_id IN (SELECT value FROM json_each(?)))
      AND proof_asset.tenant_id = ? AND proof_asset.status = 'indexed' AND proof_asset.deleted_at IS NULL
      AND (proof_asset.document_status IS NULL OR proof_asset.document_status = 'effective')
      AND (proof_asset.classification = 'public' OR proof_asset.department_scope = '*'
        OR instr(',' || proof_asset.department_scope || ',', ',' || ? || ',') > 0)
    LIMIT 30`).bind(
      JSON.stringify(seedIds), input.tenantId, JSON.stringify(seedIds), JSON.stringify(seedIds),
      input.tenantId, input.department,
    ).all<{ id: string }>();
  const ids = [...seedIds, ...(relatedRows.results ?? []).map((row) => row.id)];
  if (!ids.length) return { seeds, segments: [] };
  const limit = Math.min(input.limit ?? 20, 50);
  const rows = await getD1().prepare(`
    SELECT m.segment_id, m.asset_id, COUNT(DISTINCT m.entity_id) AS hits
    FROM ontology_mentions m
    JOIN segments s ON s.id = m.segment_id
    JOIN assets a ON a.id = s.asset_id
    WHERE m.tenant_id = ? AND m.entity_id IN (SELECT value FROM json_each(?))
      AND a.tenant_id = ? AND a.status = 'indexed' AND a.deleted_at IS NULL
      AND (a.document_status IS NULL OR a.document_status = 'effective')
      AND (a.classification = 'public' OR a.department_scope = '*'
        OR instr(',' || a.department_scope || ',', ',' || ? || ',') > 0)
    GROUP BY m.segment_id
    ORDER BY hits DESC
    LIMIT ${limit}
  `).bind(input.tenantId, JSON.stringify(ids), input.tenantId, input.department)
    .all<{ segment_id: string; asset_id: string; hits: number }>();
  return {
    seeds,
    segments: (rows.results ?? []).map((r) => ({
      segmentId: r.segment_id, assetId: r.asset_id, entityHits: Number(r.hits),
    })),
  };
}

export async function ontologyStats(tenantId: string) {
  await ensureOntologySchema();
  const db = getD1();
  const [byKind, totals] = await Promise.all([
    db.prepare(`SELECT kind, COUNT(*) AS n FROM ontology_entities
      WHERE tenant_id = ? GROUP BY kind ORDER BY n DESC`)
      .bind(tenantId).all<{ kind: string; n: number }>(),
    db.prepare(`SELECT
        (SELECT COUNT(*) FROM ontology_entities WHERE tenant_id = ?1) AS entities,
        (SELECT COUNT(*) FROM ontology_relations WHERE tenant_id = ?1) AS relations,
        (SELECT COUNT(*) FROM ontology_mentions WHERE tenant_id = ?1) AS mentions`)
      .bind(tenantId).first<{ entities: number; relations: number; mentions: number }>(),
  ]);
  return {
    entities: Number(totals?.entities || 0),
    relations: Number(totals?.relations || 0),
    mentions: Number(totals?.mentions || 0),
    byKind: (byKind.results ?? []).map((r) => ({ kind: r.kind, count: Number(r.n) })),
  };
}
