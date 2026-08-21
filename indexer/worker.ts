/**
 * Queue consumer for large-document indexing.
 *
 * Pages Functions can only produce queue messages, not consume them, so this
 * lives as a separate Worker. It shares `lib/` and `db/` with the main app via
 * relative imports — same D1/R2/AI bindings, same schema, same chunking and
 * embedding logic — so indexing behavior never drifts between the sync path
 * (small uploads, handled inline by `/api/v1/assets`) and this async path
 * (large uploads, queued by the same route).
 */
import { setRuntimeEnv, type IndexJobMessage, type QueueProducer, type RuntimeEnv } from "../lib/runtime-env";
import { analyzeMultimodalBytes } from "../lib/multimodal";
import { decodeDocumentText } from "../lib/document-text";
import { failQueuedIngest, deferQueuedIngest, resumeDeferredIngests, processIngestBatch, INGEST_CHUNK_WINDOW, getDueIngestionSources, runIngestionSource } from "../lib/rag";
import { CloudCostLimitError } from "../lib/cloud-cost-guard";
import { runDueTasks } from "../lib/scheduled-tasks";
import { expireStaleToolApprovals } from "../lib/agent-orchestrator";

// Minimal shapes of the Workers Queues consumer API this handler uses. This
// project has no @cloudflare/workers-types dependency, so bindings are typed
// by hand — same convention as the `AI` binding in lib/runtime-env.ts — rather
// than relying on ambient Workers types that aren't installed.
type QueueMessage<T> = {
  readonly body: T;
  readonly attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

type MessageBatch<T> = {
  readonly queue: string;
  readonly messages: ReadonlyArray<QueueMessage<T>>;
};

interface ScheduledController {
  readonly cron: string;
  readonly scheduledTime: Date;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface Env extends RuntimeEnv {
  INDEX_QUEUE: QueueProducer<IndexJobMessage>;
}

// 재시도 상한은 소비자 설정(`max_retries`)이 소유한다. 예전에는 앱에서도 5회를 세고
// 그 시점에 ack() 을 불렀는데, ack 은 Queues 입장에서 정상 소비라 **구성해 둔 DLQ 로
// 메시지가 영원히 흘러가지 않았다**. 이제 진짜 오류는 retry() 로 소진시켜 플랫폼이
// DLQ 로 넘기게 하고, 영구 실패 기록은 아래 DLQ 소비자가 D1 에 남긴다.
//
// 예산 소진(CloudCostLimitError)만 예외다. 그것은 문서의 결함이 아니라 정책적 차단이므로
// 재시도 대상이 아니며, deferred_budget 으로 보류하고 ack 한다.

/** DLQ 배치와 주 큐 배치를 큐 이름으로 구분한다(`*-dlq`, `*-dlq-preview`). */
function isDeadLetterQueue(queueName: string) {
  return queueName.includes("-dlq");
}

async function handleMessage(message: QueueMessage<IndexJobMessage>, env: Env) {
  const { assetId, jobId, offset } = message.body;
  try {
    const result = await processIngestBatch({
      assetId,
      jobId,
      offset,
      windowSize: INGEST_CHUNK_WINDOW,
      extract: async (original, asset) => {
        const isTextDocument = asset.mimeType.startsWith("text/")
          || asset.mimeType === "application/json"
          || /\.(txt|md|markdown|csv|json|ya?ml|html?)$/i.test(asset.title);
        if (isTextDocument) return { markdown: decodeDocumentText(original), regions: [] };
        const analysis = await analyzeMultimodalBytes(asset.title, asset.mimeType, original, asset.classification);
        return { markdown: analysis.markdown, regions: analysis.regions };
      },
    });
    if (!result.done) {
      // Re-enqueue rather than looping in this invocation: each window gets its
      // own wall-clock and subrequest budget instead of one message absorbing
      // the whole document.
      await env.INDEX_QUEUE.send({ assetId, jobId, offset: result.nextOffset });
    }
    message.ack();
  } catch (error) {
    // 예산 소진은 재시도로 풀리지 않는다. 백오프를 돌수록 같은 가드에 다시 걸리고,
    // 상한을 소진하면 결함 없는 문서가 영구 실패로 확정되며 세그먼트까지 삭제된다.
    // 보류로 분기해 이미 임베딩한 구간을 보존하고, 예산이 복구되면 스케줄러가 재개한다.
    if (error instanceof CloudCostLimitError) {
      await deferQueuedIngest(assetId, jobId, offset, error);
      message.ack();
      return;
    }
    console.error("[indexer] batch failed", { assetId, jobId, offset, attempts: message.attempts, error });
    // 일시 장애(임베딩 제공자 지연, D1 경합)를 백오프로 흡수한다. 재시도가 소진되면
    // Queues 가 DLQ 로 넘기고, 영구 실패 확정은 DLQ 소비자가 담당한다.
    message.retry({ delaySeconds: Math.min(30 * 2 ** message.attempts, 900) });
  }
}

/**
 * DLQ 소비자. 재시도를 모두 소진한 메시지가 여기로 온다.
 *
 * 소비자가 없는 DLQ 의 메시지는 4일 뒤 삭제되므로, 진단 근거가 사라지기 전에
 * D1 에 영구 실패 상태와 원인을 남기는 것이 이 핸들러의 존재 이유다.
 */
async function handleDeadLetter(message: QueueMessage<IndexJobMessage>) {
  const { assetId, jobId, offset } = message.body;
  console.error("[indexer] dead letter", { assetId, jobId, offset, attempts: message.attempts });
  try {
    const result = await failQueuedIngest(assetId, jobId, new Error(
      `색인 재시도가 모두 소진되어 실패로 확정했습니다 (마지막 offset ${offset}).`,
    ));
    if (!result.finalized) console.warn("[indexer] stale or recovered dead letter", { assetId, jobId });
    message.ack();
  } catch (error) {
    // Failure to persist finalization is not a successful consume. The DLQ
    // consumer has bounded retries so a transient D1 outage cannot strand a
    // job in `finalizing` and silently discard its recovery message.
    console.error("[indexer] dead letter 기록 실패", { assetId, jobId, error });
    message.retry({ delaySeconds: Math.min(60 * Math.max(1, message.attempts), 300) });
  }
}

const worker = {
  async queue(batch: MessageBatch<IndexJobMessage>, env: Env): Promise<void> {
    setRuntimeEnv(env);
    const deadLetter = isDeadLetterQueue(batch.queue);
    for (const message of batch.messages) {
      if (deadLetter) await handleDeadLetter(message);
      else await handleMessage(message, env);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    setRuntimeEnv(env);
    ctx.waitUntil((async () => {
      await Promise.all([
        runDueTasks().catch((error) => console.error("[indexer] scheduled tasks failed", error)),
        expireStaleToolApprovals().catch((error) => console.error("[indexer] approval expiry failed", error)),
        // 예산이 복구되면 보류된 색인을 이어서 진행한다. 예산이 여전히 막혀 있으면
        // 아무것도 하지 않고 돌아오므로 매 주기 호출해도 안전하다.
        resumeDeferredIngests()
          .then((result) => { if (result.resumed) console.log("[indexer] 보류 색인 재개", result); })
          .catch((error) => console.error("[indexer] 보류 색인 재개 실패", error)),
        (async () => {
          const sources = await getDueIngestionSources("iljin");
          for (const source of sources) {
            try {
              await runIngestionSource(source.id, env);
            } catch (error) {
              console.error("[indexer] scheduled ingestion failed", { sourceId: source.id, error });
            }
          }
        })(),
      ]);
    })());
  },
};

export default worker;
