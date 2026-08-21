"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import "./AgentOperations.css";

type AgentRun = {
  id: string; title?: string; objective?: string; status: string;
  current_state?: string; created_at?: string; updated_at?: string;
  error_message?: string; owner_email?: string; selectedToolId?: string;
  output?: { answer?: string; summary?: string };
};

type ChatAgent = {
  id: string;
  name: string;
  instructions: string;
  ownerEmail?: string;
  updatedAt?: string;
};

type ToolApproval = {
  id: string; run_id?: string; tool_id?: string; tool_name?: string;
  risk_level?: string; status: string; requested_by?: string;
  requested_at?: string; expires_at?: string; input_json?: string;
};

const STATUS_LABEL: Record<string, string> = {
  queued: "대기", running: "실행 중", awaiting_approval: "승인 대기",
  completed: "완료", failed: "실패", cancelled: "취소",
  pending: "대기", approved: "승인", rejected: "거절", expired: "만료", consumed: "실행됨",
};

const WORK_AGENT_TEMPLATES = [
  { id: "meeting", label: "회의 정리", objective: "회의 메모를 결정 사항, 실행 항목, 담당자와 기한으로 정리해줘." },
  { id: "briefing", label: "업무 브리핑", objective: "아래 업무 내용을 경영진이 바로 판단할 수 있는 핵심 브리핑으로 정리해줘." },
  { id: "action", label: "실행 계획", objective: "업무 목표를 우선순위, 실행 단계, 위험 요소와 확인 항목으로 구체화해줘." },
] as const;

function useEndpoint<T>(url: string, pick: (payload: Record<string, unknown>) => T[]) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // loading 초기값이 이미 true 다. 여기서 동기로 다시 세우면 effect 안의
  // setState 가 되어 연쇄 렌더를 부른다. 끝날 때 false 로만 내린다.
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(url, { cache: "no-store", signal });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "목록을 불러오지 못했습니다.");
      setItems(pick(payload));
      setError("");
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") {
        setError(cause instanceof Error ? cause.message : "목록을 불러오지 못했습니다.");
      }
    } finally {
      setLoading(false);
    }
  }, [url, pick]);

  useEffect(() => {
    const controller = new AbortController();
    // load() 를 여기서 바로 부르면 내부 setState 가 effect 와 같은 틱에 돌아
    // 연쇄 렌더가 된다. 마이크로태스크로 한 틱 미룬다.
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  return { items, loading, error, reload: () => { setLoading(true); void load(); } };
}

export function AgentTasksView({ currentUser }: { currentUser: { role: string } }) {
  const pickAgentRuns = useCallback((payload: Record<string, unknown>) => (payload.runs as AgentRun[]) ?? [], []);
  const pickChatAgents = useCallback((payload: Record<string, unknown>) => (payload.agents as ChatAgent[]) ?? [], []);
  const { items, loading, error, reload: reloadRuns } = useEndpoint<AgentRun>(
    "/api/v1/agent/runs?limit=50",
    pickAgentRuns,
  );
  const { items: agents, loading: agentsLoading, error: agentsError, reload: reloadAgents } = useEndpoint<ChatAgent>("/api/v1/agents", pickChatAgents);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [editingAgent, setEditingAgent] = useState<ChatAgent | null>(null);
  const [createError, setCreateError] = useState("");
  const [createNotice, setCreateNotice] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<(typeof WORK_AGENT_TEMPLATES)[number]["id"]>("meeting");
  const [workInput, setWorkInput] = useState("");
  const [workRunning, setWorkRunning] = useState(false);
  const [workNotice, setWorkNotice] = useState("");
  const [workError, setWorkError] = useState("");
  const canManageAgents = currentUser.role === "admin";

  const saveAgent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedInstructions = instructions.trim();
    if (!trimmedName || !trimmedInstructions || creating) return;
    setCreating(true);
    setCreateError("");
    setCreateNotice("");
    try {
      const response = await fetch("/api/v1/agents", {
        method: editingAgent ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingAgent?.id, name: trimmedName, instructions: trimmedInstructions }),
      });
      const payload = await response.json() as { agent?: ChatAgent; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "에이전트를 생성하지 못했습니다.");
      setName("");
      setInstructions("");
      setCreateNotice(editingAgent ? `/${payload.agent?.name || trimmedName} 에이전트를 수정했습니다.` : `/${payload.agent?.name || trimmedName} 명령으로 AI 채팅에서 호출할 수 있습니다.`);
      setEditingAgent(null);
      reloadAgents();
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "에이전트를 생성하지 못했습니다.");
    } finally {
      setCreating(false);
    }
  };

  const editAgent = (agent: ChatAgent) => {
    setEditingAgent(agent);
    setName(agent.name);
    setInstructions(agent.instructions);
    setCreateError("");
    setCreateNotice("");
  };

  const deleteAgent = async (agent: ChatAgent) => {
    if (deletingId || !window.confirm(`/${agent.name} 에이전트를 삭제할까요?`)) return;
    setDeletingId(agent.id);
    setCreateError("");
    setCreateNotice("");
    try {
      const response = await fetch("/api/v1/agents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: agent.id }),
      });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "에이전트를 삭제하지 못했습니다.");
      if (editingAgent?.id === agent.id) {
        setEditingAgent(null);
        setName("");
        setInstructions("");
      }
      setCreateNotice(`/${agent.name} 에이전트를 삭제했습니다.`);
      reloadAgents();
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "에이전트를 삭제하지 못했습니다.");
    } finally {
      setDeletingId("");
    }
  };

  const runWorkAssistant = async () => {
    if (workRunning) return;
    const template = WORK_AGENT_TEMPLATES.find((item) => item.id === selectedTemplateId) ?? WORK_AGENT_TEMPLATES[0];
    const objective = [template.objective, workInput.trim()].filter(Boolean).join("\n\n");
    const selectedTool = { id: "work.assistant" };
    // Tool마다 입력 계약은 분리한다. 업무 Agent는 임의의 검색어가 아니라 작업 원문을 받는다.
    const toolInput = selectedTool.id === "knowledge.search"
      ? { query: workInput.trim() }
      : selectedTool.id === "work.assistant"
        ? { task: objective }
        : {};
    setWorkRunning(true); setWorkError(""); setWorkNotice("");
    try {
      const response = await fetch("/api/v1/agent/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ objective, tool_id: selectedTool.id, tool_input: toolInput }),
      });
      const payload = await response.json() as { run?: AgentRun; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "업무 Agent를 실행하지 못했습니다.");
      setWorkNotice(`업무 Agent 실행을 ${payload.run?.status === "completed" ? "완료" : "시작"}했습니다.`);
      setWorkInput("");
      reloadRuns();
    } catch (cause) {
      setWorkError(cause instanceof Error ? cause.message : "업무 Agent를 실행하지 못했습니다.");
    } finally { setWorkRunning(false); }
  };

  return (
    <div className="view-stack agent-ops agent-ops-page">
      <div className="page-heading agent-ops-heading">
        <div>
          <span className="section-kicker">AGENT RUNS</span>
          <p>최근 실행된 업무와 현재 상태를 한 곳에서 확인하세요.</p>
        </div>
        <span className="agent-ops-count">{items.length}건</span>
      </div>
      <section className="panel agent-workbench" aria-labelledby="work-assistant-title">
        <div className="agent-create-heading"><div><span className="section-kicker">WORK ASSISTANT</span><h2 id="work-assistant-title">업무 Agent 실행</h2><p>작업 원문을 바탕으로 실행 가능한 초안을 만들고, 결과는 아래 실행 기록에 남습니다.</p></div></div>
        <div className="agent-work-template-list" role="list" aria-label="업무 Agent 템플릿">
          {WORK_AGENT_TEMPLATES.map((template) => <button key={template.id} type="button" role="listitem" className={selectedTemplateId === template.id ? "selected" : ""} onClick={() => setSelectedTemplateId(template.id)}>{template.label}</button>)}
        </div>
        <label className="agent-create-objective"><span>업무 내용</span><textarea value={workInput} onChange={(event) => setWorkInput(event.target.value)} rows={4} maxLength={6000} placeholder="회의 메모, 현재 상황, 원하는 결과를 입력하세요." /></label>
        <div className="agent-create-actions"><button className="primary-button" type="button" disabled={workRunning} onClick={() => void runWorkAssistant()}>{workRunning ? "실행 중…" : "work.assistant 실행"}</button></div>
        <div aria-live="polite">{workError ? <p className="agent-ops-error" role="alert">{workError}</p> : null}{workNotice ? <p className="agent-create-success">{workNotice}</p> : null}</div>
      </section>
      <section className="panel agent-create-panel" aria-labelledby="agent-create-title">
        <div className="agent-create-heading">
          <div>
            <span className="section-kicker">NEW AGENT</span>
            <h2 id="agent-create-title">{editingAgent ? "에이전트 수정" : "에이전트 생성"}</h2>
            <p>{editingAgent ? "관리자 권한으로 에이전트 이름과 역할 지침을 변경합니다." : "AI 채팅에서 / 명령으로 호출할 역할과 응답 원칙을 등록하세요."}</p>
          </div>
        </div>
        <form className="agent-create-form" onSubmit={saveAgent}>
          <label className="agent-create-name">
            <span>에이전트 이름</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="예: 안전 점검 Agent"
              maxLength={80}
              minLength={2}
              required
            />
          </label>
          <label className="agent-create-objective">
            <span>역할 지침</span>
            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="예: 안전 규정과 현장 점검 기준을 근거로 핵심 위험, 확인 항목, 조치 우선순위를 정리해줘."
              maxLength={2000}
              minLength={2}
              rows={3}
              required
            />
            <small>{instructions.length}/2,000자</small>
          </label>
          <div className="agent-create-actions">
            {editingAgent ? <button className="quiet-button" type="button" disabled={creating} onClick={() => { setEditingAgent(null); setName(""); setInstructions(""); }}>취소</button> : null}
            <button className="primary-button agent-create-submit" type="submit" disabled={creating || name.trim().length < 2 || instructions.trim().length < 2}>
              {creating ? "저장 중…" : editingAgent ? "변경 저장" : "에이전트 생성"}
            </button>
          </div>
        </form>
        <div aria-live="polite">
          {createError ? <p className="agent-ops-error" role="alert">{createError}</p> : null}
          {createNotice ? <p className="agent-create-success">{createNotice}</p> : null}
        </div>
        <div className="agent-command-list" aria-label="등록된 채팅 에이전트">
          <strong>채팅 호출 명령</strong>
          {agentsLoading ? <span>불러오는 중…</span>
            : agentsError ? <span className="agent-create-inline-error">{agentsError}</span>
            : agents.length ? <ul>{agents.map((agent) => <li key={agent.id}>
              <div className="agent-command-copy"><code>/{agent.name}</code><span>{agent.instructions}</span>{canManageAgents && agent.ownerEmail ? <small>생성자 · {agent.ownerEmail}</small> : null}</div>
              {canManageAgents ? <div className="agent-command-actions"><button type="button" onClick={() => editAgent(agent)}>수정</button><button type="button" className="danger-button" disabled={deletingId === agent.id} onClick={() => void deleteAgent(agent)}>{deletingId === agent.id ? "삭제 중…" : "삭제"}</button></div> : null}
            </li>)}</ul>
            : <span>등록된 에이전트가 없습니다.</span>}
        </div>
      </section>
      <section className="panel agent-ops-panel" aria-label="Agent 실행 목록">

        {loading ? <p className="agent-ops-note">불러오는 중…</p>
          : error ? <p className="agent-ops-error" role="alert">{error}</p>
          : !items.length ? <p className="agent-ops-note">실행한 업무가 없습니다.</p>
          : (
            <ol className="agent-run-list">
              {items.map((run) => (
                <li key={run.id} className={`agent-run agent-run--${run.status}`}>
                  <div className="agent-run-head">
                    <strong>{run.title || run.objective || run.id}</strong>
                    <span className={`status-pill status-${run.status}`}>{STATUS_LABEL[run.status] ?? run.status}</span>
                  </div>
                  <div className="agent-run-meta">
                    {run.current_state ? <span>단계 · {run.current_state}</span> : null}
                    {run.updated_at ? <span>{new Date(run.updated_at).toLocaleString("ko-KR")}</span> : null}
                    <span className="mono">{run.id}</span>
                  </div>
                  {/* 실패는 감추지 않는다. 원인과 Trace 를 함께 보여야 문의가 성립한다. */}
                  {run.error_message ? <p className="agent-run-error">{run.error_message}</p> : null}
                  {run.selectedToolId === "work.assistant" && run.output ? <section className="agent-run-result"><strong>업무 Agent 결과</strong><p>{run.output.answer || run.output.summary || "결과를 정리하고 있습니다."}</p></section> : null}
                </li>
              ))}
            </ol>
          )}
      </section>
    </div>
  );
}

export function ToolApprovalsView({ currentUser }: { currentUser: { email: string; role: string } }) {
  const { items, loading, error, reload } = useEndpoint<ToolApproval>(
    "/api/v1/tool-approvals?limit=100",
    (payload) => (payload.approvals as ToolApproval[]) ?? [],
  );
  const [busyId, setBusyId] = useState("");
  const [actionError, setActionError] = useState("");
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});

  const canDecide = currentUser.role === "admin" || currentUser.role === "manager";

  const decide = async (approval: ToolApproval, decision: "approved" | "rejected") => {
    if (busyId) return;
    // 거절은 사유가 필요하다. 승인과 취소를 같은 버튼으로 묶지 않는다.
    const note = decision === "rejected" ? window.prompt("거절 사유를 입력해 주세요.")?.trim() : undefined;
    if (decision === "rejected" && !note) return;
    setBusyId(approval.id);
    setActionError("");
    try {
      const response = await fetch(`/api/v1/tool-approvals/${encodeURIComponent(approval.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "승인 처리를 완료하지 못했습니다.");
      reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "승인 처리를 완료하지 못했습니다.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="view-stack agent-ops agent-ops-page">
      <div className="page-heading agent-ops-heading">
        <div>
          <span className="section-kicker">TOOL APPROVALS</span>
          <p>실행 전 검토가 필요한 Tool 요청을 확인하고 처리하세요.</p>
        </div>
        <span className="agent-ops-count">{items.filter((a) => a.status === "pending").length}건 대기</span>
      </div>
      <section className="panel agent-ops-panel" aria-label="Tool 승인 요청 목록">

        {!canDecide ? <p className="agent-ops-note">승인 처리는 관리자 또는 매니저만 가능합니다. 목록은 조회만 됩니다.</p> : null}
        <div aria-live="polite">
          {actionError ? <p className="agent-ops-error" role="alert">{actionError}</p> : null}
        </div>

        {loading ? <p className="agent-ops-note">불러오는 중…</p>
          : error ? <p className="agent-ops-error" role="alert">{error}</p>
          : !items.length ? <p className="agent-ops-note">승인 요청이 없습니다.</p>
          : (
            <ul className="approval-list">
              {items.map((approval) => {
                const isSelf = approval.requested_by === currentUser.email;
                const pending = approval.status === "pending";
                return (
                  <li key={approval.id} className="approval-card">
                    <div className="approval-head">
                      <span className={`risk-pill risk-${approval.risk_level ?? "R0"}`}>{approval.risk_level ?? "R0"}</span>
                      <strong>{approval.tool_name || approval.tool_id || approval.id}</strong>
                      <span className={`status-pill status-${approval.status}`}>{STATUS_LABEL[approval.status] ?? approval.status}</span>
                    </div>
                    <div className="approval-meta">
                      {approval.requested_by ? <span>요청 · {approval.requested_by}</span> : null}
                      {approval.requested_at ? <span>{new Date(approval.requested_at).toLocaleString("ko-KR")}</span> : null}
                      {approval.expires_at ? <span>만료 · {new Date(approval.expires_at).toLocaleString("ko-KR")}</span> : null}
                    </div>
                    {approval.input_json ? <pre className="approval-input">{approval.input_json}</pre> : null}

                    {pending && canDecide ? (
                      <div className="approval-actions">
                        {/* 자가 승인은 서버가 막는다. 여기서도 눌리지 않게 해 왕복을 줄인다. */}
                        {isSelf ? <span className="approval-blocked">본인이 요청한 건은 승인할 수 없습니다.</span> : null}
                        <label>
                          <input
                            type="checkbox"
                            checked={Boolean(confirmed[approval.id])}
                            onChange={(event) => setConfirmed((value) => ({ ...value, [approval.id]: event.target.checked }))}
                          />
                          영향 범위와 외부 변경 여부를 확인했습니다.
                        </label>
                        <button type="button" className="danger-button" disabled={!confirmed[approval.id] || busyId === approval.id} onClick={() => void decide(approval, "rejected")}>거절</button>
                        <button type="button" className="primary-button" disabled={!confirmed[approval.id] || isSelf || busyId === approval.id} onClick={() => void decide(approval, "approved")}>
                          {busyId === approval.id ? "처리 중…" : "승인"}
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
      </section>
    </div>
  );
}
