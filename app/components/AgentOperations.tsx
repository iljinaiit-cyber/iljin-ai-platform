"use client";

import { useCallback, useEffect, useState } from "react";
import "./AgentOperations.css";

type AgentRun = {
  id: string; title?: string; objective?: string; status: string;
  current_state?: string; created_at?: string; updated_at?: string;
  error_message?: string; owner_email?: string;
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

export function AgentTasksView() {
  const { items, loading, error } = useEndpoint<AgentRun>(
    "/api/v1/agent/runs?limit=50",
    (payload) => (payload.runs as AgentRun[]) ?? [],
  );

  return (
    <div className="view-stack agent-ops">
      <section className="panel">
        <div className="panel-title">
          <div><span className="section-kicker">AGENT RUNS</span><h2>업무 실행 이력</h2></div>
          <span>{items.length}건</span>
        </div>

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
    <div className="view-stack agent-ops">
      <section className="panel">
        <div className="panel-title">
          <div><span className="section-kicker">TOOL APPROVALS</span><h2>업무 Tool 승인</h2></div>
          <span>{items.filter((a) => a.status === "pending").length}건 대기</span>
        </div>

        {!canDecide ? <p className="agent-ops-note">승인 처리는 관리자 또는 매니저만 가능합니다. 목록은 조회만 됩니다.</p> : null}
        {actionError ? <p className="agent-ops-error" role="alert">{actionError}</p> : null}

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
                        <button type="button" className="danger-button" disabled={busyId === approval.id} onClick={() => void decide(approval, "rejected")}>거절</button>
                        <button type="button" className="primary-button" disabled={isSelf || busyId === approval.id} onClick={() => void decide(approval, "approved")}>
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
