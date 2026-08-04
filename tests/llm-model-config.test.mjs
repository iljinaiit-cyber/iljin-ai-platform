import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("default Cloudflare model is GLM 5.2", async () => {
  const source = await readFile(new URL("lib/llm-gateway.ts", root), "utf8");
  assert.match(source, /DEFAULT_CLOUDFLARE_MODEL\s*=\s*"@cf\/zai-org\/glm-5\.2"/);
});

test("llm-gateway no longer references Kimi K2.6 as default", async () => {
  const source = await readFile(new URL("lib/llm-gateway.ts", root), "utf8");
  assert.doesNotMatch(source, /kimi-k2\.6/i, "Kimi K2.6 references should be removed from llm-gateway");
});

test("llm-gateway supports model override parameters", async () => {
  const source = await readFile(new URL("lib/llm-gateway.ts", root), "utf8");
  assert.match(source, /overrideModel/);
  assert.match(source, /localModelOverride/);
  assert.match(source, /cloudflareModelOverride/);
});

test("completeWithCloudflare accepts overrideModel parameter", async () => {
  const source = await readFile(new URL("lib/llm-gateway.ts", root), "utf8");
  assert.match(source, /completeWithCloudflare[\s\S]*?overrideModel\?: string/);
});

test("completeWithLocal accepts overrideModel parameter", async () => {
  const source = await readFile(new URL("lib/llm-gateway.ts", root), "utf8");
  assert.match(source, /completeWithLocal[\s\S]*?overrideModel\?: string/);
});

test("completeWithGateway policy includes model overrides", async () => {
  const source = await readFile(new URL("lib/llm-gateway.ts", root), "utf8");
  assert.match(source, /localModelOverride\?: string/);
  assert.match(source, /cloudflareModelOverride\?: string/);
});

test("RuntimeEnv includes TTS and image model env vars", async () => {
  const source = await readFile(new URL("lib/runtime-env.ts", root), "utf8");
  assert.match(source, /CLOUDFLARE_TTS_MODEL/);
  assert.match(source, /CLOUDFLARE_IMAGE_MODEL/);
});

test("llm-model-config.ts exists with MODEL_FEATURE_CATALOG", async () => {
  const source = await readFile(new URL("lib/llm-model-config.ts", root), "utf8");
  assert.match(source, /export const MODEL_FEATURE_CATALOG/);
  assert.match(source, /"chat"/);
  assert.match(source, /"embedding"/);
  assert.match(source, /"rerank"/);
  assert.match(source, /"tts"/);
  assert.match(source, /"image_gen"/);
  assert.match(source, /"vlm"/);
});

test("llm-model-config default chat model is GLM 5.2", async () => {
  const source = await readFile(new URL("lib/llm-model-config.ts", root), "utf8");
  assert.match(source, /feature:\s*"chat"[\s\S]*?defaultModel:\s*"@cf\/zai-org\/glm-5\.2"/);
});

test("llm-model-config exports getEffectiveModel and updateModelConfig", async () => {
  const source = await readFile(new URL("lib/llm-model-config.ts", root), "utf8");
  assert.match(source, /export async function getEffectiveModel/);
  assert.match(source, /export async function updateModelConfig/);
  assert.match(source, /export async function getModelConfigDashboard/);
});

test("llm-model-config creates llm_model_config table", async () => {
  const source = await readFile(new URL("lib/llm-model-config.ts", root), "utf8");
  assert.match(source, /CREATE TABLE IF NOT EXISTS llm_model_config/);
});

test("admin llm-models route exists with GET and PATCH", async () => {
  const source = await readFile(new URL("app/api/admin/llm-models/route.ts", root), "utf8");
  assert.match(source, /export async function GET/);
  assert.match(source, /export async function PATCH/);
  assert.match(source, /getModelConfigDashboard/);
  assert.match(source, /updateModelConfig/);
});

test("admin-governance feature catalog updated to GLM 5.2", async () => {
  const source = await readFile(new URL("lib/admin-governance.ts", root), "utf8");
  assert.match(source, /GLM 5\.2/);
  assert.doesNotMatch(source, /Kimi K2\.6/i, "Kimi K2.6 should be removed from admin-governance");
});

test("admin-governance exports writeAudit", async () => {
  const source = await readFile(new URL("lib/admin-governance.ts", root), "utf8");
  assert.match(source, /export async function writeAudit/);
});

test("multimodal-output uses CLOUDFLARE_TTS_MODEL env var", async () => {
  const source = await readFile(new URL("lib/multimodal-output.ts", root), "utf8");
  assert.match(source, /runtime\.CLOUDFLARE_TTS_MODEL/);
  assert.match(source, /runtime\.CLOUDFLARE_IMAGE_MODEL/);
});

test("AdminGovernance component has llmModels tab", async () => {
  const source = await readFile(new URL("app/components/AdminGovernance.tsx", root), "utf8");
  assert.match(source, /"llmModels"/);
  assert.match(source, /LLM 모델/);
  assert.match(source, /modelConfigRequest/);
  assert.match(source, /mutateModel/);
});

test("AdminGovernance component renders model config cards", async () => {
  const source = await readFile(new URL("app/components/AdminGovernance.tsx", root), "utf8");
  assert.match(source, /modelConfigs/);
  assert.match(source, /modelDrafts/);
  assert.match(source, /모델 설정 저장/);
});

test("chat completions route resolves model overrides from DB config", async () => {
  const source = await readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8");
  assert.match(source, /getEffectiveModel/);
  assert.match(source, /localModelOverride/);
  assert.match(source, /cloudflareModelOverride/);
});

test("rag.ts providerPolicy supports model overrides", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");
  assert.match(source, /localModelOverride/);
  assert.match(source, /cloudflareModelOverride/);
});
