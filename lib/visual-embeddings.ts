import { getRuntimeEnv, type RuntimeEnv } from "./runtime-env";
import type { GatewaySensitivity } from "./llm-gateway";

export const VISUAL_EMBEDDING_MODEL = "embed-v4.0";
const VISUAL_EMBEDDING_DIMENSIONS = 1024;
const MAX_VISUAL_EMBEDDING_BYTES = 6 * 1024 * 1024;
const SUPPORTED_VISUAL_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type VisualEmbedding = {
  vector: number[];
  model: typeof VISUAL_EMBEDDING_MODEL;
  dimensions: number;
};

const sensitivityRank: Record<GatewaySensitivity, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
};

function allowedEgressSensitivity(value: string | undefined): GatewaySensitivity {
  return value === "internal" || value === "confidential" ? value : "public";
}

function isVisualSearchEnabled(runtime: RuntimeEnv) {
  return !(runtime.DISABLED_AI_KINDS || "").split(",").map((value) => value.trim()).includes("visual_search");
}

export function isVisualEmbeddingConfigured(
  sensitivity: GatewaySensitivity = "internal",
  runtime: RuntimeEnv = getRuntimeEnv(),
) {
  return isVisualSearchEnabled(runtime)
    && Boolean(runtime.COHERE_API_KEY?.trim() && runtime.CLOUDFLARE_ACCOUNT_ID?.trim() && runtime.CLOUDFLARE_AI_GATEWAY_ID?.trim())
    && sensitivityRank[sensitivity] <= sensitivityRank[allowedEgressSensitivity(runtime.MAX_EGRESS_SENSITIVITY)];
}

function asBase64(data: ArrayBuffer) {
  const bytes = new Uint8Array(data);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function readVector(payload: unknown) {
  const vector = (payload as { embeddings?: { float?: unknown[][] } })?.embeddings?.float?.[0];
  if (!Array.isArray(vector) || vector.length !== VISUAL_EMBEDDING_DIMENSIONS
    || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error("Cohere visual embedding response is invalid.");
  }
  return vector as number[];
}

async function requestVisualEmbedding(
  content: Array<{ type: "image_url"; image_url: { url: string } } | { type: "text"; text: string }>,
  inputType: "search_document" | "search_query",
) {
  const runtime = getRuntimeEnv();
  const accountId = runtime.CLOUDFLARE_ACCOUNT_ID?.trim();
  const gatewayId = runtime.CLOUDFLARE_AI_GATEWAY_ID?.trim();
  const apiKey = runtime.COHERE_API_KEY?.trim();
  if (!accountId || !gatewayId || !apiKey) throw new Error("Cohere AI Gateway is not configured.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/cohere/v2/embed`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Client-Name": "iljin-ai-rag",
      },
      body: JSON.stringify({
        model: VISUAL_EMBEDDING_MODEL,
        input_type: inputType,
        inputs: [{ content }],
        embedding_types: ["float"],
        output_dimension: VISUAL_EMBEDDING_DIMENSIONS,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Cohere visual embedding request failed: HTTP ${response.status}`);
    return {
      vector: readVector(await response.json()),
      model: VISUAL_EMBEDDING_MODEL,
      dimensions: VISUAL_EMBEDDING_DIMENSIONS,
    } satisfies VisualEmbedding;
  } finally {
    clearTimeout(timeout);
  }
}

/** Cohere's multimodal vector shares one space with text queries for visual retrieval. */
export async function embedVisualAsset(
  data: ArrayBuffer,
  mimeType: string,
  sensitivity: GatewaySensitivity = "internal",
): Promise<VisualEmbedding | undefined> {
  if (!SUPPORTED_VISUAL_MIME_TYPES.has(mimeType) || data.byteLength > MAX_VISUAL_EMBEDDING_BYTES
    || !isVisualEmbeddingConfigured(sensitivity)) return undefined;
  return requestVisualEmbedding([
    { type: "image_url", image_url: { url: `data:${mimeType};base64,${asBase64(data)}` } },
  ], "search_document");
}

export async function embedVisualQuery(
  query: string,
  sensitivity: GatewaySensitivity = "internal",
): Promise<VisualEmbedding | undefined> {
  if (!query.trim() || !isVisualEmbeddingConfigured(sensitivity)) return undefined;
  return requestVisualEmbedding([{ type: "text", text: query.trim().slice(0, 2_000) }], "search_query");
}
