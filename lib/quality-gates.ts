import { getD1 } from "../db";
import { requirePermission } from "./admin-governance";
import type { Principal } from "./identity";
import { getGatewayStatus } from "./llm-gateway";
import { ensureAgentSchema } from "./agent-orchestrator";
import { ensureRagSchema } from "./rag";

type CountRow = { count: number };

export async function getQualityGates(principal: Principal) {
  await requirePermission(principal, "admin.operations");
  await Promise.all([ensureRagSchema(), ensureAgentSchema()]);
  const db = getD1();
  const [indexedAssets, retrievalSamples, failedJobs, tenantIndex, approvalExecutions] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count FROM assets
      WHERE tenant_id = ? AND status = 'indexed' AND deleted_at IS NULL`).bind(principal.tenantId).first<CountRow>(),
    db.prepare(`SELECT COUNT(*) AS count FROM retrieval_traces
      WHERE tenant_id = ? AND created_at >= datetime('now', '-7 days')`).bind(principal.tenantId).first<CountRow>(),
    db.prepare(`SELECT COUNT(*) AS count FROM index_jobs j JOIN assets a ON a.id = j.asset_id
      WHERE a.tenant_id = ? AND j.status = 'failed'`).bind(principal.tenantId).first<CountRow>(),
    db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'index' AND name = 'retrieval_traces_tenant_created_idx'`).first<CountRow>(),
    db.prepare(`SELECT COUNT(*) AS count FROM tool_executions e JOIN agent_runs a ON a.id = e.run_id
      WHERE a.tenant_id = ? AND e.approval_request_id IS NOT NULL`).bind(principal.tenantId).first<CountRow>(),
  ]);
  const gateway = getGatewayStatus();
  const local = gateway.providers.find((provider) => provider.id === "local");
  const cloudflare = gateway.providers.find((provider) => provider.id === "cloudflare");
  const gates = [
    {
      id: "G1-INDEX",
      label: "문서 인덱싱",
      passed: Number(indexedAssets?.count || 0) > 0,
      value: Number(indexedAssets?.count || 0),
      unit: "assets",
      evidence: Number(indexedAssets?.count || 0) > 0 ? "D1에 인덱싱 완료 Asset이 있습니다." : "인덱싱 완료 문서가 필요합니다.",
    },
    {
      id: "G1-RETRIEVAL",
      label: "검색 실행 증적",
      passed: Number(retrievalSamples?.count || 0) > 0,
      value: Number(retrievalSamples?.count || 0),
      unit: "7일 표본",
      evidence: Number(retrievalSamples?.count || 0) > 0 ? "최근 7일 Retrieval Trace가 수집되었습니다." : "운영 검색 표본이 필요합니다.",
    },
    {
      id: "SEC-TENANT",
      label: "Tenant 검색 격리",
      passed: Number(tenantIndex?.count || 0) === 1,
      value: Number(tenantIndex?.count || 0),
      unit: "index",
      evidence: Number(tenantIndex?.count || 0) === 1 ? "Tenant 복합 인덱스와 서버 필터가 적용되었습니다." : "Tenant 격리 인덱스를 확인해야 합니다.",
    },
    {
      id: "OPS-INDEX",
      label: "색인 Job 건전성",
      passed: Number(failedJobs?.count || 0) === 0,
      value: Number(failedJobs?.count || 0),
      unit: "failed",
      evidence: Number(failedJobs?.count || 0) === 0 ? "실패 상태인 색인 Job이 없습니다." : "실패 색인 Job 재처리가 필요합니다.",
    },
    {
      id: "LLM-FAILOVER",
      label: "2단계 LLM Failover",
      passed: Boolean(local?.configured && cloudflare?.configured),
      value: Number(Boolean(local?.configured)) + Number(Boolean(cloudflare?.configured)),
      unit: "/2 providers",
      evidence: local?.configured && cloudflare?.configured
        ? "로컬 Primary와 Cloudflare GLM-4.7 Flash Fallback이 모두 구성되었습니다."
        : "로컬 Endpoint와 Cloudflare AI binding 또는 REST 인증 설정이 필요합니다.",
    },
    {
      id: "AGENT-HITL",
      label: "고위험 Tool 승인 실행",
      passed: Number(approvalExecutions?.count || 0) > 0,
      value: Number(approvalExecutions?.count || 0),
      unit: "executions",
      evidence: Number(approvalExecutions?.count || 0) > 0 ? "승인과 연결된 Tool 실행 증적이 있습니다." : "승인 후 실행 Pilot 증적이 필요합니다.",
    },
  ];
  return {
    gates,
    summary: {
      passed: gates.filter((gate) => gate.passed).length,
      total: gates.length,
      readiness: gates.every((gate) => gate.passed) ? "ready" : "action_required",
    },
    checkedAt: new Date().toISOString(),
  };
}
