import { getD1 } from "../db";
import type { Principal } from "./identity";
import type { GatewayCompletion, GatewaySensitivity } from "./llm-gateway";

export async function ensureLlmTelemetrySchema() {
  const db = getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS llm_invocations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      conversation_id TEXT,
      trace_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      sensitivity TEXT NOT NULL DEFAULT 'internal',
      fallback_used INTEGER NOT NULL DEFAULT 0,
      fallback_path_json TEXT NOT NULL DEFAULT '[]',
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS llm_invocations_trace_uidx ON llm_invocations(tenant_id, trace_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS llm_invocations_tenant_created_idx ON llm_invocations(tenant_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS llm_invocations_provider_created_idx ON llm_invocations(tenant_id, provider, created_at)"),
  ]);
}

export async function recordLlmInvocation(input: {
  principal: Principal;
  conversationId: string;
  completion: GatewayCompletion;
  sensitivity: GatewaySensitivity;
}) {
  await ensureLlmTelemetrySchema();
  const fallbackPath = input.completion.fallback?.path || [input.completion.provider];
  await getD1().prepare(`INSERT INTO llm_invocations
    (id, tenant_id, owner_email, conversation_id, trace_id, provider, model, sensitivity,
     fallback_used, fallback_path_json, prompt_tokens, completion_tokens, total_tokens, latency_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, trace_id) DO UPDATE SET
      provider = excluded.provider,
      model = excluded.model,
      fallback_used = excluded.fallback_used,
      fallback_path_json = excluded.fallback_path_json,
      prompt_tokens = excluded.prompt_tokens,
      completion_tokens = excluded.completion_tokens,
      total_tokens = excluded.total_tokens,
      latency_ms = excluded.latency_ms`).bind(
      `llm_${crypto.randomUUID()}`,
      input.principal.tenantId,
      input.principal.email,
      input.conversationId,
      input.completion.traceId,
      input.completion.provider,
      input.completion.model,
      input.sensitivity,
      input.completion.fallback ? 1 : 0,
      JSON.stringify(fallbackPath),
      Number(input.completion.usage?.prompt_tokens || 0),
      Number(input.completion.usage?.completion_tokens || 0),
      Number(input.completion.usage?.total_tokens || 0),
      input.completion.latencyMs,
      new Date().toISOString(),
    ).run();
}

export async function getConversationSensitivity(
  principal: Principal,
  conversationId: string,
): Promise<GatewaySensitivity | undefined> {
  await ensureLlmTelemetrySchema();
  const row = await getD1().prepare(`SELECT sensitivity FROM llm_invocations
    WHERE tenant_id = ? AND owner_email = ? AND conversation_id = ?
    ORDER BY created_at DESC LIMIT 1`).bind(
      principal.tenantId,
      principal.email,
      conversationId,
    ).first<{ sensitivity: GatewaySensitivity }>();
  return row?.sensitivity;
}
