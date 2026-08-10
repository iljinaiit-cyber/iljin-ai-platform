import { getD1 } from "../db";
import { AuthError, type Principal } from "./identity";
import { requirePermission, writeAudit } from "./admin-governance";

export type ModelFeature =
  | "chat"
  | "chat_local"
  | "embedding"
  | "embedding_local"
  | "rerank"
  | "vlm"
  | "tts"
  | "image_gen";

export type ModelProvider = "cloudflare" | "local" | "openai_compatible";

export type ModelConfigEntry = {
  feature: ModelFeature;
  provider: ModelProvider;
  model: string;
  enabled: boolean;
  updatedBy?: string;
  updatedAt?: string;
};

export const MODEL_FEATURE_CATALOG: Array<{
  feature: ModelFeature;
  category: string;
  label: string;
  description: string;
  provider: ModelProvider;
  defaultModel: string;
}> = [
  {
    feature: "chat",
    category: "Cloud LLM",
    label: "채팅 (Cloud)",
    description: "Cloudflare Workers AI 채팅 모델 — 메인 응답 생성",
    provider: "cloudflare",
    defaultModel: "@cf/zai-org/glm-4.7-flash",
  },
  {
    feature: "chat_local",
    category: "Local LLM",
    label: "채팅 (Local)",
    description: "로컬 vLLM/Ollama 채팅 모델 — 1차 Provider",
    provider: "local",
    defaultModel: "gemma4:latest",
  },
  {
    feature: "embedding",
    category: "Embedding",
    label: "임베딩 (Cloud)",
    description: "Cloudflare Workers AI 임베딩 모델 — 벡터 검색",
    provider: "cloudflare",
    defaultModel: "@cf/baai/bge-m3",
  },
  {
    feature: "embedding_local",
    category: "Embedding",
    label: "임베딩 (Local)",
    description: "로컬 임베딩 모델 — vLLM/Ollama",
    provider: "local",
    defaultModel: "nomic-embed-text",
  },
  {
    feature: "rerank",
    category: "Rerank",
    label: "리랭크",
    description: "Cloudflare Workers AI 리랭크 모델 — 검색 결과 재정렬",
    provider: "cloudflare",
    defaultModel: "@cf/baai/bge-reranker-base",
  },
  {
    feature: "vlm",
    category: "Vision",
    label: "비전 (VLM)",
    description: "이미지 캡셔닝 비전 언어 모델 — 멀티모달 입력",
    provider: "cloudflare",
    defaultModel: "@cf/google/gemma-4-26b-a4b-it",
  },
  {
    feature: "tts",
    category: "TTS",
    label: "음성 합성 (TTS)",
    description: "텍스트 음성 변환 모델 — 멀티모달 출력",
    provider: "cloudflare",
    defaultModel: "@cf/myshell-ai/tts-ko",
  },
  {
    feature: "image_gen",
    category: "Image",
    label: "이미지 생성",
    description: "텍스트→이미지 생성 모델 — 멀티모달 출력",
    provider: "cloudflare",
    defaultModel: "@cf/black-forest-labs/flux-1-schnell",
  },
];

let modelConfigSchemaPromise: Promise<void> | undefined;

export function ensureModelConfigSchema() {
  if (!modelConfigSchemaPromise) {
    modelConfigSchemaPromise = (async () => {
      const db = getD1();
      await db.prepare(`CREATE TABLE IF NOT EXISTS llm_model_config (
        tenant_id TEXT NOT NULL,
        feature TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, feature)
      )`).run();
    })().catch((error) => {
      modelConfigSchemaPromise = undefined;
      throw error;
    });
  }
  return modelConfigSchemaPromise;
}

type ModelConfigRow = {
  feature: string;
  provider: string;
  model: string;
  enabled: number;
  updated_by: string;
  updated_at: string;
};

function rowToEntry(row: ModelConfigRow, feature: ModelFeature): ModelConfigEntry {
  return {
    feature,
    provider: row.provider as ModelProvider,
    model: row.model,
    enabled: Boolean(row.enabled),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

export async function getModelConfigs(tenantId: string): Promise<ModelConfigEntry[]> {
  await ensureModelConfigSchema();
  const result = await getD1().prepare(
    `SELECT feature, provider, model, enabled, updated_by, updated_at
     FROM llm_model_config WHERE tenant_id = ?`,
  ).bind(tenantId).all<ModelConfigRow>();

  const saved = new Map(
    (result.results || []).map((row) => [row.feature as ModelFeature, row]),
  );

  return MODEL_FEATURE_CATALOG.map((catalog) => {
    const row = saved.get(catalog.feature);
    if (row) return rowToEntry(row, catalog.feature);
    return {
      feature: catalog.feature,
      provider: catalog.provider,
      model: catalog.defaultModel,
      enabled: true,
    } satisfies ModelConfigEntry;
  });
}

export async function getEffectiveModel(
  tenantId: string,
  feature: ModelFeature,
  envFallback?: string,
): Promise<string> {
  await ensureModelConfigSchema();
  const row = await getD1().prepare(
    `SELECT model, enabled FROM llm_model_config WHERE tenant_id = ? AND feature = ?`,
  ).bind(tenantId, feature).first<{ model: string; enabled: number }>();

  if (row?.enabled && row.model) return row.model;
  if (envFallback) return envFallback;
  const catalog = MODEL_FEATURE_CATALOG.find((c) => c.feature === feature);
  return catalog?.defaultModel || "";
}

export async function updateModelConfig(input: {
  principal: Principal;
  feature: ModelFeature;
  model: string;
  enabled: boolean;
  traceId: string;
}) {
  await requirePermission(input.principal, "admin.settings");
  const catalog = MODEL_FEATURE_CATALOG.find((c) => c.feature === input.feature);
  if (!catalog) {
    throw new AuthError("알 수 없는 모델 기능입니다.", 400, "AUTH_INVALID_INPUT");
  }
  const model = input.model.trim().slice(0, 200);
  if (!model) {
    throw new AuthError("모델명을 입력해 주세요.", 400, "AUTH_INVALID_INPUT");
  }
  const now = new Date().toISOString();
  await getD1().prepare(
    `INSERT INTO llm_model_config (tenant_id, feature, provider, model, enabled, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, feature) DO UPDATE SET
       provider = excluded.provider, model = excluded.model, enabled = excluded.enabled,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(
    input.principal.tenantId,
    input.feature,
    catalog.provider,
    model,
    input.enabled ? 1 : 0,
    input.principal.email,
    now,
  ).run();

  await writeAudit({
    principal: input.principal,
    action: "governance.model_config.updated",
    resourceType: "llm_model_config",
    resourceId: input.feature,
    traceId: input.traceId,
    details: { feature: input.feature, model, enabled: input.enabled },
  });
}

export async function getModelConfigDashboard(principal: Principal) {
  await requirePermission(principal, "admin.settings");
  const configs = await getModelConfigs(principal.tenantId);
  return {
    catalog: MODEL_FEATURE_CATALOG,
    configs,
  };
}
