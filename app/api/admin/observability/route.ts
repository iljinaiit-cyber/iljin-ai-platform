import { getModelConfigDashboard } from "../../../../lib/llm-model-config";
import { listProviderProbes } from "../../../../lib/provider-resources";
import { getD1 } from "../../../../db";
import { resolvePrincipal, requireRole } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const p = await resolvePrincipal(request); requireRole(p, ["admin"]);
    const [retrieval, invocations, models, probes] = await Promise.all([
      getD1().prepare(`SELECT COUNT(*) AS count, AVG(latency_ms) AS average_latency_ms,
          AVG(evidence_confidence) AS avg_evidence_confidence,
          SUM(CASE WHEN verifier_status = 'insufficient' THEN 1 ELSE 0 END) AS verifier_insufficient,
          SUM(CASE WHEN fusion_strategy = 'rrf' THEN 1 ELSE 0 END) AS rrf_applied
        FROM retrieval_traces WHERE tenant_id = ? AND created_at >= datetime('now', '-24 hours')`)
        .bind(p.tenantId).first<{
          count: number; average_latency_ms: number | null; avg_evidence_confidence: number | null;
          verifier_insufficient: number; rrf_applied: number;
        }>(),
      getD1().prepare(`SELECT COUNT(*) AS count, AVG(latency_ms) AS average_latency_ms
        FROM llm_invocations WHERE tenant_id = ? AND created_at >= datetime('now', '-24 hours')`)
        .bind(p.tenantId).first<{ count: number; average_latency_ms: number | null }>(),
      getModelConfigDashboard(p),
      listProviderProbes(p.tenantId),
    ]);
    return ok({ models, probes: [...probes.values()], telemetry: { retrieval, invocations } }, traceId);
  } catch (error) { return fail(error, traceId); }
}
