import { getD1 } from "../db";
import type { Principal } from "./identity";
import type { GatewayProvider } from "./llm-gateway";
import type { ProbeResult } from "./readiness";

export type ProviderProbeSnapshot = ProbeResult & {
  provider: GatewayProvider;
  checkedAt: string;
};

let providerResourceSchemaPromise: Promise<void> | undefined;

export function ensureProviderResourceSchema() {
  if (!providerResourceSchemaPromise) {
    providerResourceSchemaPromise = getD1().batch([
      getD1().prepare(`CREATE TABLE IF NOT EXISTS provider_resource_probes (
        tenant_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        detail TEXT NOT NULL,
        checked_by TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, provider)
      )`),
      getD1().prepare("CREATE INDEX IF NOT EXISTS provider_resource_probes_checked_idx ON provider_resource_probes(tenant_id, checked_at)"),
    ]).then(() => undefined).catch((error: unknown) => {
      providerResourceSchemaPromise = undefined;
      throw error;
    });
  }
  return providerResourceSchemaPromise;
}

export async function recordProviderProbe(
  principal: Principal,
  provider: GatewayProvider,
  probe: ProbeResult,
) {
  await ensureProviderResourceSchema();
  const checkedAt = new Date().toISOString();
  await getD1().prepare(`INSERT INTO provider_resource_probes
    (tenant_id, provider, status, latency_ms, detail, checked_by, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, provider) DO UPDATE SET
      status = excluded.status,
      latency_ms = excluded.latency_ms,
      detail = excluded.detail,
      checked_by = excluded.checked_by,
      checked_at = excluded.checked_at`).bind(
        principal.tenantId,
        provider,
        probe.status,
        probe.latencyMs,
        probe.detail.slice(0, 500),
        principal.email,
        checkedAt,
      ).run();
  return { provider, ...probe, checkedAt } satisfies ProviderProbeSnapshot;
}

export async function listProviderProbes(tenantId: string) {
  await ensureProviderResourceSchema();
  const rows = await getD1().prepare(`SELECT provider, status, latency_ms, detail, checked_at
    FROM provider_resource_probes WHERE tenant_id = ?`).bind(tenantId).all<{
      provider: GatewayProvider;
      status: ProbeResult["status"];
      latency_ms: number;
      detail: string;
      checked_at: string;
    }>();
  return new Map<GatewayProvider, ProviderProbeSnapshot>(
    (rows.results || []).map((row: {
      provider: GatewayProvider;
      status: ProbeResult["status"];
      latency_ms: number;
      detail: string;
      checked_at: string;
    }) => [
      row.provider,
      {
        provider: row.provider,
        status: row.status,
        latencyMs: row.latency_ms,
        detail: row.detail,
        checkedAt: row.checked_at,
      },
    ]),
  );
}
