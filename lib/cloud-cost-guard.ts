import { getD1 } from "../db";

const USD_MICRO = 1_000_000;
// Kept below the external $50 ceiling to absorb short concurrent-request overshoot.
export const CLOUD_COST_CAP_USD = 45;
const CLOUD_COST_CAP_MICRO_USD = CLOUD_COST_CAP_USD * USD_MICRO;

type CloudCostReservation = { period: string; reservedMicroUsd: number };

export class CloudCostLimitError extends Error {
  constructor() {
    super(`Cloudflare AI 월간 비용 한도($${CLOUD_COST_CAP_USD.toFixed(2)})에 도달했습니다. 로컬 모델만 사용할 수 있습니다.`);
  }
}

function billingPeriod() { return new Date().toISOString().slice(0, 7); }

// Published Cloudflare Workers AI prices, USD per million tokens
// (developers.cloudflare.com/workers-ai/models/<model>/).
const MODEL_RATES: Record<string, { input: number; output: number }> = {
  "@cf/zai-org/glm-4.7-flash": { input: 0.06, output: 0.4 },
};
// DEFAULT_CLOUDFLARE_MODEL 이 바뀔 때마다 위 표에 실제 가격을 추가해야 한다 — 표에
// 없는 모델은 이 보수적 상한으로 과금되어 예산 상한에 너무 일찍 도달할 수 있다.
const UNLISTED_MODEL_RATE = { input: 1.4, output: 6.667 };

function modelRates(model: string) {
  return MODEL_RATES[model] || UNLISTED_MODEL_RATE;
}

function outputLimit(value?: number) {
  if (!Number.isFinite(value)) return 1_200;
  return Math.min(Math.max(Math.round(value!), 512), 4_096);
}

function estimateMicrousd(model: string, inputTokens: number, outputTokens: number) {
  const rates = modelRates(model);
  return Math.max(1, Math.ceil(inputTokens * rates.input + outputTokens * rates.output));
}

let schemaReady: Promise<void> | undefined;

function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getD1().prepare(`CREATE TABLE IF NOT EXISTS cloud_cost_guard (
    period TEXT PRIMARY KEY,
    spent_microusd INTEGER NOT NULL DEFAULT 0,
    reserved_microusd INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`).run().then(() => undefined).catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  }
  return schemaReady;
}

export async function reserveCloudflareLlmSpend(messages: Array<{ content: string }>, model: string, maxOutputTokens?: number) {
  await ensureSchema();
  const period = billingPeriod();
  // Covers gateway system instructions and RAG context in addition to caller messages.
  const inputTokens = Math.ceil(messages.reduce((sum, message) => sum + message.content.length, 0) / 4) + 20_000;
  const reservedMicroUsd = estimateMicrousd(model, inputTokens, outputLimit(maxOutputTokens));
  const db = getD1();
  await db.prepare(`INSERT INTO cloud_cost_guard (period, spent_microusd, reserved_microusd, updated_at)
    VALUES (?, 0, 0, ?) ON CONFLICT(period) DO NOTHING`).bind(period, new Date().toISOString()).run();
  const result = await db.prepare(`UPDATE cloud_cost_guard
    SET reserved_microusd = reserved_microusd + ?, updated_at = ?
    WHERE period = ? AND spent_microusd + reserved_microusd + ? <= ?`)
    .bind(reservedMicroUsd, new Date().toISOString(), period, reservedMicroUsd, CLOUD_COST_CAP_MICRO_USD).run() as { meta?: { changes?: number } };
  if (result.meta?.changes !== 1) throw new CloudCostLimitError();
  return { period, reservedMicroUsd } satisfies CloudCostReservation;
}

export async function settleCloudflareLlmSpend(
  reservation: CloudCostReservation,
  model: string,
  usage?: { prompt_tokens?: number; completion_tokens?: number },
) {
  const actualMicroUsd = usage
    ? estimateMicrousd(model, Number(usage.prompt_tokens || 0), Number(usage.completion_tokens || 0))
    : reservation.reservedMicroUsd;
  await getD1().prepare(`UPDATE cloud_cost_guard
    SET spent_microusd = spent_microusd + ?, reserved_microusd = MAX(0, reserved_microusd - ?), updated_at = ?
    WHERE period = ?`).bind(actualMicroUsd, reservation.reservedMicroUsd, new Date().toISOString(), reservation.period).run();
}

export async function releaseCloudflareLlmSpend(reservation: CloudCostReservation) {
  await getD1().prepare(`UPDATE cloud_cost_guard
    SET reserved_microusd = MAX(0, reserved_microusd - ?), updated_at = ? WHERE period = ?`)
    .bind(reservation.reservedMicroUsd, new Date().toISOString(), reservation.period).run();
}

export async function assertCloudCostAvailable() {
  await ensureSchema();
  const period = billingPeriod();
  const row = await getD1().prepare(`SELECT spent_microusd, reserved_microusd FROM cloud_cost_guard WHERE period = ?`)
    .bind(period).first<{ spent_microusd: number; reserved_microusd: number }>();
  if (Number(row?.spent_microusd || 0) + Number(row?.reserved_microusd || 0) >= CLOUD_COST_CAP_MICRO_USD) throw new CloudCostLimitError();
}

export async function getCloudCostStatus() {
  await ensureSchema();
  const period = billingPeriod();
  const row = await getD1().prepare(`SELECT spent_microusd, reserved_microusd FROM cloud_cost_guard WHERE period = ?`)
    .bind(period).first<{ spent_microusd: number; reserved_microusd: number }>();
  const spentMicroUsd = Number(row?.spent_microusd || 0);
  const reservedMicroUsd = Number(row?.reserved_microusd || 0);
  return { period, capUsd: CLOUD_COST_CAP_USD, spentUsd: spentMicroUsd / USD_MICRO, reservedUsd: reservedMicroUsd / USD_MICRO, cloudPaidCallsBlocked: spentMicroUsd + reservedMicroUsd >= CLOUD_COST_CAP_MICRO_USD };
}
