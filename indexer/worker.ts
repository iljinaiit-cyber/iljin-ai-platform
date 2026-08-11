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
import { failQueuedIngest, processIngestBatch, INGEST_CHUNK_WINDOW, getDueIngestionSources, runIngestionSource } from "../lib/rag";
import { runDueTasks } from "../lib/scheduled-tasks";

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

// A queue message is retried by Cloudflare on throw, but an attempt count also
// caps retries at the application level so a permanently-broken file (corrupt
// PDF, unsupported structure) fails the job instead of retrying forever.
const MAX_ATTEMPTS = 5;

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
        const analysis = await analyzeMultimodalBytes(asset.title, asset.mimeType, original);
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
    console.error("[indexer] batch failed", { assetId, jobId, offset, attempts: message.attempts, error });
    if (message.attempts >= MAX_ATTEMPTS) {
      await failQueuedIngest(assetId, jobId, error);
      message.ack();
      return;
    }
    // Backs off transient upstream failures (embedding provider hiccups, D1
    // contention) instead of hammering them again immediately.
    message.retry({ delaySeconds: Math.min(30 * 2 ** message.attempts, 900) });
  }
}

const worker = {
  async queue(batch: MessageBatch<IndexJobMessage>, env: Env): Promise<void> {
    setRuntimeEnv(env);
    for (const message of batch.messages) {
      await handleMessage(message, env);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    setRuntimeEnv(env);
    ctx.waitUntil((async () => {
      await Promise.all([
        runDueTasks().catch((error) => console.error("[indexer] scheduled tasks failed", error)),
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
