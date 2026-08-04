import { getD1, getR2 } from "../db";
import {
  completeWithCloudflare,
  createTraceId,
  isCloudflareProviderConfigured,
  isLocalProviderConfigured,
  openAiCompatibleBaseUrl,
} from "./llm-gateway";
import { getRuntimeEnv } from "./runtime-env";
import { probeRagPipeline } from "./rag";

export type ProbeResult = {
  status: "ready" | "degraded" | "not_configured";
  latencyMs: number;
  detail: string;
};

async function timedProbe(run: () => Promise<string>): Promise<ProbeResult> {
  const startedAt = Date.now();
  try {
    const detail = await run();
    return { status: "ready", latencyMs: Date.now() - startedAt, detail };
  } catch (error) {
    return {
      status: "degraded",
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : "probe_failed",
    };
  }
}

async function fetchProviderProbe(url: string, path: string, headers: Record<string, string>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}${path}`, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`provider_http_${response.status}`);
    return "authenticated_models_probe_ok";
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeD1(): Promise<ProbeResult> {
  return timedProbe(async () => {
    await getD1().prepare("SELECT 1 AS ok").first();
    return "query_ok";
  });
}

export async function probeR2(): Promise<ProbeResult> {
  if (!getRuntimeEnv().BUCKET) {
    return { status: "not_configured", latencyMs: 0, detail: "storage_binding_missing" };
  }
  return timedProbe(async () => {
    await getR2().head("__iljin_health__/sentinel");
    return "binding_ok";
  });
}

export async function probeLocalLlm(): Promise<ProbeResult> {
  const runtime = getRuntimeEnv();
  if (!isLocalProviderConfigured(runtime)) {
    return { status: "not_configured", latencyMs: 0, detail: "local_endpoint_or_access_token_missing" };
  }
  const headers: Record<string, string> = {};
  if (runtime.LOCAL_LLM_API_KEY) headers.Authorization = `Bearer ${runtime.LOCAL_LLM_API_KEY}`;
  if (runtime.LOCAL_LLM_ACCESS_CLIENT_ID && runtime.LOCAL_LLM_ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = runtime.LOCAL_LLM_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = runtime.LOCAL_LLM_ACCESS_CLIENT_SECRET;
  }
  return timedProbe(() => fetchProviderProbe(openAiCompatibleBaseUrl(runtime.LOCAL_LLM_BASE_URL!), "/models", headers));
}

export async function probeCloudflareAi(executeModel = false): Promise<ProbeResult> {
  const runtime = getRuntimeEnv();
  if (!isCloudflareProviderConfigured(runtime)) {
    return { status: "not_configured", latencyMs: 0, detail: "cloud_llm_binding_or_rest_credentials_missing" };
  }
  if (!executeModel) {
    return { status: "ready", latencyMs: 0, detail: "cloud_llm_binding_or_rest_credentials_available" };
  }
  return timedProbe(async () => {
    await completeWithCloudflare(
      [{ role: "user", content: "OK라고만 답하세요." }],
      createTraceId(),
      512,
    );
    return "cloud_llm_model_probe_ok";
  });
}

export async function runReadinessProbes() {
  const [database, objectStorage, embedding, reranker, cloudflarePrimary, localFallback] = await Promise.all([
    probeD1(),
    probeR2(),
    probeRagPipeline("embedding"),
    probeRagPipeline("reranker"),
    probeCloudflareAi(),
    probeLocalLlm(),
  ]);
  const coreReady = database.status === "ready"
    && objectStorage.status === "ready"
    && embedding.status === "ready"
    && reranker.status === "ready";
  const anyLlmReady = [cloudflarePrimary, localFallback].some((probe) => probe.status === "ready");
  const fullFailoverReady = [cloudflarePrimary, localFallback].every((probe) => probe.status === "ready");
  const status = coreReady && fullFailoverReady
    ? "ready"
    : coreReady && anyLlmReady
      ? "degraded"
      : "configuration_required";
  return {
    status,
    routing: {
      primary: "cloudflare",
      fallback: "local",
      sequence: ["cloudflare", "local"],
      failoverReady: fullFailoverReady,
    },
    probes: { database, objectStorage, embedding, reranker, cloudflarePrimary, localFallback },
    checkedAt: new Date().toISOString(),
  };
}
