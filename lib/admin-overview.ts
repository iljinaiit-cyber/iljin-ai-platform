import { getD1 } from "../db";
import { ensureAgentSchema } from "./agent-orchestrator";
import { ensureConversationSchema } from "./conversations";
import { ensureFeedbackSchema } from "./feedback-board";
import { ensureIdentitySchema, type Principal } from "./identity";
import { ensureLlmTelemetrySchema } from "./llm-telemetry";
import { ensureRagSchema } from "./rag";
import { ensureSchedulePlanningSchema } from "./schedule-planning";
import { ensureScheduledTaskSchema } from "./scheduled-tasks";
import { requirePermission } from "./admin-governance";

type CountRow = { count: number | string | null };
type AggregateRow = CountRow & { total_tokens?: number | string | null; average_latency_ms?: number | string | null };

function number(value: number | string | null | undefined) {
  return Number(value || 0);
}

export async function getAdminOverview(principal: Principal) {
  await requirePermission(principal, "admin.operations");
  await Promise.all([
    ensureIdentitySchema(),
    ensureConversationSchema(),
    ensureAgentSchema(),
    ensureRagSchema(),
    ensureLlmTelemetrySchema(),
    ensureFeedbackSchema(),
    ensureScheduledTaskSchema(),
    ensureSchedulePlanningSchema(),
  ]);

  const db = getD1();
  const tenantId = principal.tenantId;
  const [users, activeUsers, conversations, agentRuns, llm, retrieval, assets, failedJobs, pendingApprovals, feedback, tools, schedules, workItems, audits] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
      FROM user_profiles WHERE tenant_id = ?`).bind(tenantId).first<{ count: number; approved: number; pending: number }>(),
    db.prepare(`SELECT COUNT(DISTINCT email) AS count FROM (
        SELECT owner_email AS email FROM conversations WHERE tenant_id = ? AND status != 'deleted' AND updated_at >= datetime('now', '-30 days')
        UNION SELECT owner_email AS email FROM agent_runs WHERE tenant_id = ? AND updated_at >= datetime('now', '-30 days')
        UNION SELECT owner_email AS email FROM llm_invocations WHERE tenant_id = ? AND created_at >= datetime('now', '-30 days')
      )`).bind(tenantId, tenantId, tenantId).first<CountRow>(),
    db.prepare(`SELECT COUNT(*) AS count,
        SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS last_30_days
      FROM conversations WHERE tenant_id = ? AND status != 'deleted'`).bind(tenantId).first<{ count: number; last_30_days: number }>(),
    db.prepare(`SELECT COUNT(*) AS count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM agent_runs WHERE tenant_id = ? AND created_at >= datetime('now', '-24 hours')`).bind(tenantId).first<{ count: number; completed: number; failed: number }>(),
    db.prepare(`SELECT COUNT(*) AS count, SUM(total_tokens) AS total_tokens, AVG(latency_ms) AS average_latency_ms
      FROM llm_invocations WHERE tenant_id = ? AND created_at >= datetime('now', '-24 hours')`).bind(tenantId).first<AggregateRow>(),
    db.prepare(`SELECT COUNT(*) AS count, AVG(latency_ms) AS average_latency_ms
      FROM retrieval_traces WHERE tenant_id = ? AND created_at >= datetime('now', '-24 hours')`).bind(tenantId).first<AggregateRow>(),
    db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'indexed' THEN 1 ELSE 0 END) AS indexed,
        COALESCE((SELECT SUM(segment_count) FROM assets WHERE tenant_id = ? AND deleted_at IS NULL), 0) AS segments
      FROM assets WHERE tenant_id = ? AND deleted_at IS NULL`).bind(tenantId, tenantId).first<{ total: number; indexed: number; segments: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM index_jobs j JOIN assets a ON a.id = j.asset_id
      WHERE a.tenant_id = ? AND j.status = 'failed'`).bind(tenantId).first<CountRow>(),
    db.prepare(`SELECT COUNT(*) AS count FROM tool_approval_requests r JOIN agent_runs a ON a.id = r.run_id
      WHERE a.tenant_id = ? AND r.status = 'pending'`).bind(tenantId).first<CountRow>(),
    db.prepare(`SELECT COUNT(*) AS count FROM feedback_posts WHERE tenant_id = ? AND status != 'resolved'`).bind(tenantId).first<CountRow>(),
    db.prepare(`SELECT COUNT(*) AS count FROM tool_registry WHERE (tenant_id = '*' OR tenant_id = ?) AND enabled = 1`).bind(tenantId).first<CountRow>(),
    db.prepare(`SELECT COUNT(*) AS count FROM scheduled_tasks WHERE tenant_id = ? AND enabled = 1`).bind(tenantId).first<CountRow>(),
    db.prepare(`SELECT COUNT(*) AS count FROM schedule_work_items WHERE tenant_id = ? AND status IN ('open', 'in_progress')`).bind(tenantId).first<CountRow>(),
    db.prepare(`SELECT COUNT(*) AS count FROM audit_logs WHERE tenant_id = ? AND created_at >= datetime('now', '-7 days')`).bind(tenantId).first<CountRow>(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    usage: {
      users: { total: number(users?.count), approved: number(users?.approved), pending: number(users?.pending), active30d: number(activeUsers?.count) },
      conversations: { total: number(conversations?.count), last30d: number(conversations?.last_30_days) },
      agentRuns24h: { total: number(agentRuns?.count), completed: number(agentRuns?.completed), failed: number(agentRuns?.failed) },
      llm24h: { total: number(llm?.count), totalTokens: number(llm?.total_tokens), averageLatencyMs: llm?.average_latency_ms == null ? null : number(llm.average_latency_ms) },
      retrieval24h: { total: number(retrieval?.count), averageLatencyMs: retrieval?.average_latency_ms == null ? null : number(retrieval.average_latency_ms) },
    },
    management: {
      assets: { total: number(assets?.total), indexed: number(assets?.indexed), segments: number(assets?.segments) },
      failedIndexJobs: number(failedJobs?.count),
      pendingApprovals: number(pendingApprovals?.count),
      openFeedback: number(feedback?.count),
      enabledTools: number(tools?.count),
      enabledSchedules: number(schedules?.count),
      openWorkItems: number(workItems?.count),
      auditEvents7d: number(audits?.count),
    },
  };
}
