import { getD1 } from "../db";
import { authorizeFeature } from "./admin-governance";
import type { Principal } from "./identity";
import { ensureAgentSchema } from "./agent-orchestrator";
import { ensureConversationSchema } from "./conversations";
import { ensureRagSchema } from "./rag";
import { ensureSchedulePlanningSchema, listScheduleAlerts } from "./schedule-planning";

export type ActivityTarget = "chat" | "search" | "tasks" | "approvals" | "documents" | "schedule";

export type ActivityItem = {
  id: string;
  type: "chat" | "search" | "agent" | "approval" | "document";
  typeLabel: string;
  title: string;
  status: string;
  createdAt: string;
  target: ActivityTarget;
  resourceId?: string;
  detail?: string;
};

export type SuggestedQuestion = {
  id: string;
  category: "frequent" | "recent";
  label: string;
  question: string;
  meta: string;
};

function toTime(value: unknown) {
  return typeof value === "string" ? value : new Date(0).toISOString();
}

function compactQuestion(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 180);
}

export async function getActivityDashboard(principal: Principal, limit = 50) {
  await authorizeFeature(principal, "activity.read", "activity");
  await Promise.all([ensureConversationSchema(), ensureAgentSchema(), ensureRagSchema(), ensureSchedulePlanningSchema()]);
  const db = getD1();
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const canReview = principal.role === "admin" || principal.role === "manager";
  const suggestionCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000).toISOString();
  const [conversations, runs, approvals, documents, searches, enabledTools, frequentQuestions, recentKnowledge] = await Promise.all([
    db.prepare(`SELECT id, title, status, updated_at FROM conversations
      WHERE tenant_id = ? AND owner_email = ? AND status = 'active'
      ORDER BY updated_at DESC LIMIT ?`).bind(principal.tenantId, principal.email, safeLimit).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, title, status, selected_tool_id, updated_at FROM agent_runs
      WHERE tenant_id = ? AND owner_email = ?
      ORDER BY updated_at DESC LIMIT ?`).bind(principal.tenantId, principal.email, safeLimit).all<Record<string, unknown>>(),
    db.prepare(`SELECT r.id, r.status, r.requester_email, r.decision_by, r.created_at,
        a.title, t.name AS tool_name
      FROM tool_approval_requests r
      JOIN agent_runs a ON a.id = r.run_id
      JOIN tool_registry t ON t.id = r.tool_id
      WHERE a.tenant_id = ? AND (r.requester_email = ? OR r.decision_by = ? OR (? = 1 AND r.status = 'pending'))
      ORDER BY r.created_at DESC LIMIT ?`).bind(
        principal.tenantId,
        principal.email,
        principal.email,
        canReview ? 1 : 0,
        safeLimit,
      ).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, title, status, classification, updated_at FROM assets
      WHERE tenant_id = ? AND owner_email = ? AND deleted_at IS NULL
      ORDER BY updated_at DESC LIMIT ?`).bind(principal.tenantId, principal.email, safeLimit).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, result_count, latency_ms, search_scope, search_provider, created_at FROM retrieval_traces
      WHERE tenant_id = ? AND owner_email = ?
      ORDER BY created_at DESC LIMIT ?`).bind(principal.tenantId, principal.email, safeLimit).all<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) AS count FROM tool_registry
      WHERE enabled = 1 AND (tenant_id = '*' OR tenant_id = ?)`).bind(principal.tenantId).first<{ count: number }>(),
    db.prepare(`SELECT m.content AS question, COUNT(*) AS use_count, MAX(m.created_at) AS last_used_at
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.tenant_id = ? AND c.owner_email = ? AND m.role = 'user'
        AND m.created_at >= ? AND length(trim(m.content)) BETWEEN 4 AND 240
        AND m.content NOT LIKE '[첨부 %'
      GROUP BY trim(m.content)
      HAVING COUNT(*) >= 2
      ORDER BY use_count DESC, last_used_at DESC
      LIMIT 4`).bind(principal.tenantId, principal.email, suggestionCutoff).all<Record<string, unknown>>(),
    db.prepare(`SELECT a.id, a.title, a.updated_at
      FROM assets a
      WHERE a.tenant_id = ? AND a.status = 'indexed' AND a.deleted_at IS NULL
        AND a.updated_at >= ?
        AND (? = 'admin' OR a.classification = 'public' OR a.department_scope = '*'
          OR instr(',' || a.department_scope || ',', ',' || ? || ',') > 0)
        AND NOT EXISTS (
          SELECT 1 FROM conversation_attachments ca
          WHERE ca.asset_id = a.id AND ca.retention = 'temporary'
        )
      ORDER BY a.updated_at DESC
      LIMIT 6`).bind(
        principal.tenantId,
        suggestionCutoff,
        principal.role,
        principal.department,
      ).all<Record<string, unknown>>(),
  ]);

  const items: ActivityItem[] = [
    ...(conversations.results || []).map((row) => ({
      id: `chat:${String(row.id)}`,
      type: "chat" as const,
      typeLabel: "AI Chat Agent",
      title: String(row.title || "새 대화"),
      status: "진행 중",
      createdAt: toTime(row.updated_at),
      target: "chat" as const,
      resourceId: String(row.id),
      detail: "저장된 대화를 이어서 진행할 수 있습니다.",
    })),
    ...(runs.results || []).map((row) => ({
      id: `agent:${String(row.id)}`,
      type: "agent" as const,
      typeLabel: "Agent",
      title: String(row.title || "Agent 작업"),
      status: String(row.status || "queued"),
      createdAt: toTime(row.updated_at),
      target: "tasks" as const,
      resourceId: String(row.id),
      detail: row.selected_tool_id ? `Tool · ${String(row.selected_tool_id)}` : "Router 작업",
    })),
    ...(approvals.results || []).map((row) => ({
      id: `approval:${String(row.id)}`,
      type: "approval" as const,
      typeLabel: "승인",
      title: String(row.tool_name || row.title || "Tool 실행 승인"),
      status: String(row.status || "pending"),
      createdAt: toTime(row.created_at),
      target: "approvals" as const,
      resourceId: String(row.id),
      detail: `${String(row.requester_email || "")} · ${String(row.title || "")}`,
    })),
    ...(documents.results || []).map((row) => ({
      id: `document:${String(row.id)}`,
      type: "document" as const,
      typeLabel: "문서",
      title: String(row.title || "문서"),
      status: String(row.status || "received"),
      createdAt: toTime(row.updated_at),
      target: "search" as const,
      resourceId: String(row.id),
      detail: `${String(row.classification || "internal")} 등급`,
    })),
    ...(searches.results || []).map((row) => ({
      id: `search:${String(row.id)}`,
      type: "search" as const,
      typeLabel: "검색",
      title: `${row.search_scope === "internet" ? "인터넷 검색" : "내부 검색"} · 근거 ${Number(row.result_count || 0)}건`,
      status: `${Number(row.latency_ms || 0)}ms`,
      createdAt: toTime(row.created_at),
      target: "search" as const,
      resourceId: String(row.id),
      detail: `${row.search_scope === "internet" ? `공개 출처 · ${String(row.search_provider || "wikimedia")}` : "사내 문서 ACL 적용"} · 검색어 원문은 저장하지 않습니다.`,
    })),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, safeLimit);

  const today = new Date().toISOString().slice(0, 10);
  const pendingApprovals = (approvals.results || []).filter((row) => row.status === "pending").length;
  const failedRuns = (runs.results || []).filter((row) => row.status === "failed").length;
  const scheduleAlerts = await listScheduleAlerts(principal, 6);
  const notifications = [
    ...(pendingApprovals ? [{
      id: "pending-approvals",
      level: "warning" as const,
      title: `Tool 승인 ${pendingApprovals}건 대기`,
      description: canReview ? "영향 범위를 확인하고 승인 또는 거절해 주세요." : "관리자 또는 매니저의 검토를 기다리고 있습니다.",
      target: "approvals" as ActivityTarget,
    }] : []),
    ...(failedRuns ? [{
      id: "failed-runs",
      level: "error" as const,
      title: `실패한 Agent 작업 ${failedRuns}건`,
      description: "실행 상세에서 오류 코드와 Trace를 확인해 주세요.",
      target: "tasks" as ActivityTarget,
    }] : []),
    ...scheduleAlerts.slice(0, 3).map((item) => ({
      id: `schedule-${item.id}`,
      level: item.alert_type === "overdue" ? "error" as const : "info" as const,
      title: item.alert_type === "overdue" ? `기한 초과: ${item.title}` : `예정된 업무: ${item.title}`,
      description: item.due_at ? new Date(item.due_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "업무 일정을 확인해 주세요.",
      target: "schedule" as ActivityTarget,
    })),
  ];

  const frequentSuggestions: SuggestedQuestion[] = (frequentQuestions.results || [])
    .map((row, index): SuggestedQuestion | null => {
      const question = compactQuestion(row.question);
      if (!question) return null;
      const useCount = Math.max(2, Number(row.use_count || 2));
      return {
        id: `frequent-${index}`,
        category: "frequent",
        label: question,
        question,
        meta: `최근 90일 ${useCount}회 질문`,
      };
    })
    .filter((item): item is SuggestedQuestion => item !== null)
    .slice(0, 3);

  const seenQuestions = new Set(frequentSuggestions.map((item) => item.question.toLocaleLowerCase("ko-KR")));
  const recentSuggestions: SuggestedQuestion[] = [];
  for (const row of recentKnowledge.results || []) {
    const title = compactQuestion(row.title);
    if (!title) continue;
    const question = `${title}의 최신 변경사항과 우리 업무에 미치는 영향을 요약해줘.`;
    const dedupeKey = question.toLocaleLowerCase("ko-KR");
    if (seenQuestions.has(dedupeKey)) continue;
    seenQuestions.add(dedupeKey);
    recentSuggestions.push({
      id: `recent-${String(row.id)}`,
      category: "recent",
      label: title,
      question,
      meta: `${new Date(toTime(row.updated_at)).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} 업데이트`,
    });
    if (recentSuggestions.length === 3) break;
  }

  const fallbackSuggestions: SuggestedQuestion[] = [
    {
      id: "frequent-fallback-safety",
      category: "frequent",
      label: "최신 안전 수칙 핵심 내용",
      question: "최신 안전 수칙의 핵심 내용과 현장 적용 항목을 요약해줘.",
      meta: "자주 찾는 업무 주제",
    },
    {
      id: "frequent-fallback-maintenance",
      category: "frequent",
      label: "설비 정기 점검 기준",
      question: "설비 정기 점검 주기와 필수 확인 항목을 알려줘.",
      meta: "자주 찾는 업무 주제",
    },
    {
      id: "recent-fallback-risk",
      category: "recent",
      label: "최근 공급망 리스크",
      question: "최근 공급망 리스크 이슈와 우리 업무에 미치는 영향을 분석해줘.",
      meta: "최근 업무 이슈",
    },
    {
      id: "recent-fallback-ai",
      category: "recent",
      label: "제조업 AI 활용 동향",
      question: "최근 제조업 AI 활용 동향과 실무 적용 사례를 정리해줘.",
      meta: "최근 업무 이슈",
    },
  ];
  const suggestions = [...frequentSuggestions, ...recentSuggestions];
  for (const fallback of fallbackSuggestions) {
    if (suggestions.length >= 6) break;
    if (suggestions.some((item) => item.category === fallback.category && item.label === fallback.label)) continue;
    suggestions.push(fallback);
  }

  return {
    items,
    notifications,
    suggestedQuestions: suggestions.slice(0, 6),
    summary: {
      todayActivities: items.filter((item) => item.createdAt.slice(0, 10) === today).length,
      pendingApprovals,
      enabledTools: Number(enabledTools?.count || 0),
      failedRuns,
    },
    checkedAt: new Date().toISOString(),
  };
}

export function activityCsv(items: ActivityItem[]) {
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
  return [
    ["유형", "활동", "상태", "일시", "상세"].map(escape).join(","),
    ...items.map((item) => [item.typeLabel, item.title, item.status, item.createdAt, item.detail || ""].map(escape).join(",")),
  ].join("\r\n");
}
