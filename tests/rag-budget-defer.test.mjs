// 예산 소진 보류(deferred_budget) 동작 테스트.
//
// 이 저장소의 테스트 다수는 소스 문자열을 정규식으로 확인한다. 이 경로는 그 방식으로
// 검증할 수 없다 — 핵심 단언이 "세그먼트를 **지우지 않는다**"이고, 소스에 DELETE 문이
// 존재하는지 여부는 그것을 증명하지 못한다(실패 확정 경로에는 정상적으로 존재한다).
// 그래서 lib/rag.ts 를 esbuild 로 번들한 뒤 D1 과 큐를 가짜로 물려 실제로 실행하고,
// 발행된 SQL 을 수집해 확인한다.
//
// 배경: 월 예산 상한에 도달하면 CloudCostLimitError 가 임베딩 제공자 장애와 구분되지
// 않아, 재시도 5회를 소진한 뒤 결함 없는 문서가 영구 실패로 확정되고 이미 생성된
// 세그먼트까지 삭제됐다. 예산 소진은 문서의 결함이 아니라 정책적 차단이므로 보류하고,
// 예산이 복구되면 마지막 지점부터 재개해야 한다.
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const COST_CAP_MICRO_USD = 45 * 1_000_000;

let rag;
let bundleDir;

before(async () => {
  // esbuild 는 vite 를 통해 들어오는 전이 의존성이다. 없으면 테스트를 건너뛴다.
  const esbuild = await import("esbuild").catch(() => undefined);
  if (!esbuild) return;
  bundleDir = await mkdtemp(join(tmpdir(), "iljin-rag-defer-"));
  const outfile = join(bundleDir, "rag.mjs");
  await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../lib/rag.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    outfile,
  });
  rag = await import(pathToFileURL(outfile).href);
});

after(async () => {
  if (bundleDir) await rm(bundleDir, { recursive: true, force: true });
});

function requireRag(t) {
  if (rag) return true;
  t.skip("esbuild를 사용할 수 없어 예산 보류 경로를 실행하지 못했습니다.");
  return false;
}

/**
 * 발행된 SQL 과 바인딩 값을 수집하는 D1 스텁.
 *
 * 인메모리 SQLite 까지 갈 필요가 없다 — 이 경로에서 확인할 것은 "어떤 문장이 발행되고
 * 어떤 값이 묶였는가"이지 질의 결과가 아니다. 조회 결과는 `rows` 로 주입한다.
 */
function recordingDb(rows = {}, options = {}) {
  const statements = [];
  let batchCalls = 0;
  const matchRow = (sql, table) => Object.entries(table).find(([needle]) => sql.includes(needle))?.[1];
  const schemaColumns = {
    assets: ["id", "tenant_id", "title", "source_type", "mime_type", "status", "classification", "department_scope", "storage_key", "checksum", "original_size", "original_etag", "original_uploaded_at", "embedding_model", "embedding_dimensions", "visual_search_enabled", "version", "document_status", "effective_from", "effective_to", "owner_email", "segment_count", "deleted_at", "created_at", "updated_at"],
    segments: ["id", "asset_id", "parent_id", "ordinal", "heading", "content", "page_number", "char_start", "char_end", "token_count", "embedding", "embedding_model", "vector_indexed_at", "time_start_ms", "time_end_ms", "speaker", "modality", "created_at"],
    index_jobs: ["id", "asset_id", "status", "stage", "error_code", "error_message", "attempt_count", "processed_chunks", "total_chunks", "deferred_until", "resume_offset", "last_error_code", "started_at", "completed_at", "created_at"],
    retrieval_traces: ["id", "tenant_id", "owner_email", "query_hash", "department", "result_count", "top_score", "latency_ms", "embedding_model", "embedding_dimensions", "rerank_model", "rerank_status", "candidate_count", "query_variant_count", "fusion_strategy", "fusion_candidate_count", "rerank_candidate_count", "evidence_confidence", "verifier_status", "graph_seed_count", "graph_candidate_count", "graph_boosted_count", "search_scope", "search_provider", "created_at"],
    visual_regions: ["id", "asset_id", "segment_id", "page_number", "region_type", "ordinal", "bbox_json", "caption", "ocr_text", "table_markdown", "labels_json", "chart_json", "created_at"],
    visual_embeddings: ["id", "asset_id", "segment_id", "embedding", "embedding_model", "dimensions", "created_at"],
    ingestion_sources: ["id", "tenant_id", "name", "source_type", "connection_config", "schedule_interval_minutes", "classification", "department_scope", "enabled", "last_run_at", "last_run_status", "last_run_summary", "total_ingested", "created_at", "updated_at", "created_by"],
  };
  const db = {
    prepare(sql) {
      const entry = { sql, args: [] };
      statements.push(entry);
      return {
        sql,
        bind(...args) { entry.args = args; return this; },
        run: async () => ({ meta: { changes: 1 } }),
        first: async () => matchRow(sql, rows.first || {}) ?? null,
        all: async () => {
          const table = sql.match(/^PRAGMA table_info\((\w+)\)/)?.[1];
          return { results: table ? (schemaColumns[table] || []).map((name) => ({ name })) : matchRow(sql, rows.all || {}) ?? [] };
        },
      };
    },
    batch: async () => {
      batchCalls += 1;
      if (options.failBatchCalls?.includes(batchCalls)) throw new Error("simulated D1 finalization failure");
      return Object.values(schemaColumns).map((columns) => ({ results: columns.map((name) => ({ name })) }));
    },
  };
  return { db, statements };
}

function setEnv({ db, queueSends, spentMicroUsd = 0 }) {
  globalThis.__ILJIN_RUNTIME_ENV__ = {
    DB: db,
    INDEX_QUEUE: queueSends ? { send: async (message) => { queueSends.push(message); } } : undefined,
    VECTOR_INDEX: undefined,
    BUCKET: undefined,
  };
  return spentMicroUsd;
}

const sqlOf = (statements) => statements.map((entry) => entry.sql).join("\n---\n");

test("예산 보류는 이미 생성한 세그먼트를 지우지 않는다", async (t) => {
  if (!requireRag(t)) return;
  // 메시지 offset(3)보다 실제 진척(7)이 앞선 상황. 재개 지점은 큰 쪽이어야 한다.
  const { db, statements } = recordingDb({ first: { "SELECT processed_chunks": { processed_chunks: 7 } } });
  setEnv({ db });

  const result = await rag.deferQueuedIngest("ast_defer", "job_defer", 3, new Error("월간 비용 한도 도달"));

  assert.doesNotMatch(sqlOf(statements), /DELETE\s+FROM\s+segments/i, "보류 경로가 세그먼트를 삭제했다");
  assert.doesNotMatch(sqlOf(statements), /status\s*=\s*'failed'/i, "보류 경로가 실패로 확정했다");
  const update = statements.find((entry) => /UPDATE index_jobs SET status = 'deferred_budget'/.test(entry.sql));
  assert.ok(update, "deferred_budget 전이가 발행되지 않았다");
  assert.equal(result.resumeOffset, 7);
  assert.ok(update.args.includes(7), "resume_offset 이 진척값으로 기록되지 않았다");
  assert.ok(update.args.includes("job_defer"));
});

test("실패 확정 경로는 여전히 세그먼트를 정리한다", async (t) => {
  if (!requireRag(t)) return;
  // 대조군. 위 테스트가 "삭제가 어디에서도 일어나지 않아서" 통과하는 것이 아니라,
  // 두 경로가 실제로 다르게 동작해서 통과한다는 것을 확인한다.
  const { db, statements } = recordingDb({ all: { "SELECT id FROM segments": [{ id: "seg_1" }] } });
  setEnv({ db });

  await rag.failQueuedIngest("ast_fail", "job_fail", new Error("복구 불가"));

  assert.match(sqlOf(statements), /DELETE FROM segments/, "실패 확정 경로가 세그먼트를 정리하지 않았다");
  assert.match(sqlOf(statements), /status = 'finalizing'/, "실패 정리 전 원자적 작업 선점이 없다");
  assert.match(sqlOf(statements), /status = 'failed'/);
});

test("실패 정리 저장이 실패하면 finalizing 작업을 복구 가능한 실패로 확정한다", async (t) => {
  if (!requireRag(t)) return;
  const { db, statements } = recordingDb({}, { failBatchCalls: [1] });
  setEnv({ db });

  const result = await rag.failQueuedIngest("ast_recover", "job_recover", new Error("복구 불가"));

  assert.deepEqual(result, { finalized: false, recovered: true });
  const sql = sqlOf(statements);
  assert.match(sql, /status = 'finalizing'/);
  assert.match(sql, /INDEX_FINALIZATION_FAILED/);
  assert.match(sql, /WHERE id = \? AND asset_id = \? AND status = 'finalizing'/);
});

test("예산이 여전히 막혀 있으면 보류 작업을 재투입하지 않는다", async (t) => {
  if (!requireRag(t)) return;
  const queueSends = [];
  const { db } = recordingDb({
    first: { cloud_cost_guard: { spent_microusd: COST_CAP_MICRO_USD, reserved_microusd: 0 } },
  });
  setEnv({ db, queueSends });

  const result = await rag.resumeDeferredIngests();

  assert.equal(result.blocked, true);
  assert.equal(result.resumed, 0);
  assert.equal(queueSends.length, 0, "예산이 막힌 상태에서 재투입해 재시도 루프를 만들었다");
});

test("예산이 복구되면 마지막 지점부터 재투입한다", async (t) => {
  if (!requireRag(t)) return;
  const queueSends = [];
  const { db, statements } = recordingDb({
    first: { cloud_cost_guard: { spent_microusd: 0, reserved_microusd: 0 } },
    all: { "WHERE status = 'deferred_budget'": [{ id: "job_a", asset_id: "ast_a", resume_offset: 12 }] },
  });
  setEnv({ db, queueSends });

  const result = await rag.resumeDeferredIngests();

  assert.equal(result.blocked, false);
  assert.equal(result.resumed, 1);
  assert.deepEqual(queueSends, [{ assetId: "ast_a", jobId: "job_a", offset: 12 }]);
  assert.match(sqlOf(statements), /UPDATE index_jobs SET status = 'queued'[\s\S]*deferred_until = NULL/);
});

test("큐 바인딩이 없으면 아무것도 하지 않는다", async (t) => {
  if (!requireRag(t)) return;
  const { db, statements } = recordingDb();
  setEnv({ db });

  const result = await rag.resumeDeferredIngests();

  assert.equal(result.resumed, 0);
  assert.equal(result.reason, "queue_not_configured");
  assert.doesNotMatch(sqlOf(statements), /UPDATE index_jobs SET status = 'queued'/);
});
