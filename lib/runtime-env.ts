export type IndexJobMessage = {
  assetId: string;
  jobId: string;
  offset: number;
};

// Minimal shape of the Workers Queues producer binding — this project has no
// @cloudflare/workers-types dependency, so bindings are typed by hand (see the
// `AI` binding below) rather than relying on ambient Workers types.
export type QueueProducer<T> = {
  send(message: T): Promise<void>;
};

export type RuntimeEnv = {
  ASSETS?: Fetcher;
  DB?: D1Database;
  BUCKET?: R2Bucket;
  VECTOR_INDEX?: VectorizeIndex;
  // Absent in environments without the queue binding; callers fall back to
  // synchronous indexing when it is missing.
  INDEX_QUEUE?: QueueProducer<IndexJobMessage>;
  AI?: {
    run(model: string, input: Record<string, unknown>): Promise<unknown>;
    toMarkdown(
      files: { name: string; blob: Blob } | Array<{ name: string; blob: Blob }>,
      options?: Record<string, unknown>,
    ): Promise<unknown>;
  };
  LOCAL_LLM_BASE_URL?: string;
  LOCAL_LLM_MODEL?: string;
  LOCAL_LLM_API_KEY?: string;
  LOCAL_LLM_ACCESS_CLIENT_ID?: string;
  LOCAL_LLM_ACCESS_CLIENT_SECRET?: string;
  CLOUDFLARE_AI_MODEL?: string;
  CLOUDFLARE_EMBED_MODEL?: string;
  CLOUDFLARE_RERANK_MODEL?: string;
  LOCAL_EMBED_MODEL?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_AI_GATEWAY_ID?: string;
  CLOUD_VLM_MODEL?: string;
  CLOUDFLARE_TTS_MODEL?: string;
  CLOUDFLARE_IMAGE_MODEL?: string;
  TAVILY_API_KEY?: string;
  GOOGLE_SEARCH_API_KEY?: string;
  GOOGLE_SEARCH_ENGINE_ID?: string;
  BRAVE_SEARCH_API_KEY?: string;
  WEBPILOT_API_URL?: string;
  WEBPILOT_API_KEY?: string;
  JINA_API_KEY?: string;
  INTERNET_SEARCH_PROVIDER_ORDER?: string;
  LOCAL_LLM_TIMEOUT_MS?: string;
  LLM_TIMEOUT_MS?: string;
  DEFAULT_TENANT_ID?: string;
  DEFAULT_DEPARTMENT?: string;
  DEFAULT_USER_ROLE?: string;
  ALLOW_DEV_IDENTITY?: string;
  ADMIN_EMAILS?: string;
  ADMIN_BOOTSTRAP_TOKEN?: string;
};

declare global {
  // Deployment-level bindings only. Set once per request by worker/index.ts.
  var __ILJIN_RUNTIME_ENV__: RuntimeEnv | undefined;
}

export function setRuntimeEnv(runtime: RuntimeEnv) {
  globalThis.__ILJIN_RUNTIME_ENV__ = runtime;
}

export function getRuntimeEnv(): RuntimeEnv {
  if (globalThis.__ILJIN_RUNTIME_ENV__) return globalThis.__ILJIN_RUNTIME_ENV__;
  if (typeof process !== "undefined") {
    const runtime: RuntimeEnv = {
      LOCAL_LLM_BASE_URL: process.env.LOCAL_LLM_BASE_URL,
      LOCAL_LLM_MODEL: process.env.LOCAL_LLM_MODEL,
      LOCAL_LLM_API_KEY: process.env.LOCAL_LLM_API_KEY,
      LOCAL_LLM_ACCESS_CLIENT_ID: process.env.LOCAL_LLM_ACCESS_CLIENT_ID,
      LOCAL_LLM_ACCESS_CLIENT_SECRET: process.env.LOCAL_LLM_ACCESS_CLIENT_SECRET,
      CLOUDFLARE_AI_MODEL: process.env.CLOUDFLARE_AI_MODEL,
      CLOUDFLARE_EMBED_MODEL: process.env.CLOUDFLARE_EMBED_MODEL,
      CLOUDFLARE_RERANK_MODEL: process.env.CLOUDFLARE_RERANK_MODEL,
      LOCAL_EMBED_MODEL: process.env.LOCAL_EMBED_MODEL,
      CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
      CLOUDFLARE_AI_GATEWAY_ID: process.env.CLOUDFLARE_AI_GATEWAY_ID,
      CLOUD_VLM_MODEL: process.env.CLOUD_VLM_MODEL,
      CLOUDFLARE_TTS_MODEL: process.env.CLOUDFLARE_TTS_MODEL,
      CLOUDFLARE_IMAGE_MODEL: process.env.CLOUDFLARE_IMAGE_MODEL,
      TAVILY_API_KEY: process.env.TAVILY_API_KEY,
      GOOGLE_SEARCH_API_KEY: process.env.GOOGLE_SEARCH_API_KEY,
      GOOGLE_SEARCH_ENGINE_ID: process.env.GOOGLE_SEARCH_ENGINE_ID,
      BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY,
      WEBPILOT_API_URL: process.env.WEBPILOT_API_URL,
      WEBPILOT_API_KEY: process.env.WEBPILOT_API_KEY,
      JINA_API_KEY: process.env.JINA_API_KEY,
      INTERNET_SEARCH_PROVIDER_ORDER: process.env.INTERNET_SEARCH_PROVIDER_ORDER,
      LOCAL_LLM_TIMEOUT_MS: process.env.LOCAL_LLM_TIMEOUT_MS,
      LLM_TIMEOUT_MS: process.env.LLM_TIMEOUT_MS,
      DEFAULT_TENANT_ID: process.env.DEFAULT_TENANT_ID,
      DEFAULT_DEPARTMENT: process.env.DEFAULT_DEPARTMENT,
      DEFAULT_USER_ROLE: process.env.DEFAULT_USER_ROLE,
      ALLOW_DEV_IDENTITY: process.env.ALLOW_DEV_IDENTITY,
      ADMIN_EMAILS: process.env.ADMIN_EMAILS,
      ADMIN_BOOTSTRAP_TOKEN: process.env.ADMIN_BOOTSTRAP_TOKEN,
    };
    return runtime;
  }
  return {};
}
