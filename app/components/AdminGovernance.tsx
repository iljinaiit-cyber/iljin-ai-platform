"use client";

import { useCallback, useEffect, useState } from "react";

type Dashboard = {
  permissions?: Array<{ key: string; label: string }>;
  users?: Array<{ email: string; displayName?: string; department?: string; role: "user" | "manager" | "admin"; status?: "approved" | "rejected" }>;
  rolePermissions?: Array<{ role: string; permissions: Record<string, boolean> }>;
  features?: Array<{ key: string; enabled: boolean; label?: string }>;
  audit?: Array<{ id: string; actorEmail?: string; action: string; createdAt?: string }>;
};

export function AdminGovernance({ currentEmail }: { currentEmail: string }) {
  const [data, setData] = useState<Dashboard>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [userDrafts, setUserDrafts] = useState<Record<string, { displayName: string; department: string; role: "user" | "manager" | "admin"; status: "approved" | "rejected" }>>({});
  const [savingEmail, setSavingEmail] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/admin/governance", { cache: "no-store", signal });
      const payload = await response.json() as Dashboard & { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "거버넌스 정보를 불러오지 못했습니다.");
      setData(payload);
      setError("");
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "거버넌스 정보를 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // load() 를 여기서 바로 부르면 내부 setState 가 effect 와 같은 틱에 돌아
    // 연쇄 렌더가 된다. 마이크로태스크로 한 틱 미룬다.
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const on = (v: number | boolean | undefined) => v === true || v === 1;

  const update = async (body: Record<string, unknown>) => {
    setError("");
    const response = await fetch("/api/admin/governance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || "변경 사항을 저장하지 못했습니다.");
    await load();
  };

  const userDraft = (user: NonNullable<Dashboard["users"]>[number]) => userDrafts[user.email] || {
    displayName: user.displayName || "",
    department: user.department || "",
    role: user.role,
    status: user.status === "rejected" ? "rejected" as const : "approved" as const,
  };

  const saveUser = async (user: NonNullable<Dashboard["users"]>[number]) => {
    const draft = userDraft(user);
    if (!draft.displayName.trim() || !draft.department.trim()) {
      setError("이름과 부서를 입력해 주세요.");
      return;
    }
    setSavingEmail(user.email);
    try {
      await update({ action: "user", email: user.email, ...draft });
      setUserDrafts((drafts) => { const next = { ...drafts }; delete next[user.email]; return next; });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "가입자 정보를 저장하지 못했습니다.");
    } finally { setSavingEmail(""); }
  };

  return (
    <section className="panel governance-panel">
      <div className="panel-title">
        <div><span className="section-kicker">GOVERNANCE</span><h2>권한 · 기능 거버넌스</h2></div>
        <span>{currentEmail}</span>
      </div>

      {loading ? <p className="agent-ops-note">불러오는 중…</p>
        : error ? <p className="agent-ops-error" role="alert">{error}</p>
        : (
          <div className="governance-grid">
            <div>
              <h3>사용자별 권한 ({data?.users?.length ?? 0})</h3>
              <table>
                <caption className="sr-only">사용자 권한</caption>
                <thead><tr><th>이메일</th><th>부서</th><th>역할</th><th>상태</th></tr></thead>
                <tbody>
                  {(data?.users ?? []).map((u) => {
                    const draft = userDraft(u);
                    const saving = savingEmail === u.email;
                    return <tr key={u.email}>
                      <td><input className="table-input" value={draft.displayName} onChange={(event) => setUserDrafts((drafts) => ({ ...drafts, [u.email]: { ...draft, displayName: event.target.value } }))} aria-label={`${u.email} 이름`} /><small className="table-subtext">{u.email}</small></td>
                      <td><input className="table-input" value={draft.department} onChange={(event) => setUserDrafts((drafts) => ({ ...drafts, [u.email]: { ...draft, department: event.target.value } }))} aria-label={`${u.email} 부서`} /></td>
                      <td><select className="table-select" value={draft.role} onChange={(event) => setUserDrafts((drafts) => ({ ...drafts, [u.email]: { ...draft, role: event.target.value as typeof draft.role } }))} aria-label={`${u.email} 역할`}><option value="user">사용자</option><option value="manager">매니저</option><option value="admin">관리자</option></select></td>
                      <td><select className="table-select" value={draft.status} onChange={(event) => setUserDrafts((drafts) => ({ ...drafts, [u.email]: { ...draft, status: event.target.value as typeof draft.status } }))} aria-label={`${u.email} 승인 상태`}><option value="approved">승인</option><option value="rejected">접근 중지</option></select></td>
                      <td><button className="button button-secondary" type="button" disabled={saving} onClick={() => void saveUser(u)}>{saving ? "저장 중" : "저장"}</button></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>

            <div>
              <h3>역할 정책</h3>
              <ul className="feature-list">
                {(data?.rolePermissions ?? []).map((policy) => (
                  <li key={policy.role}>
                    <strong>{policy.role}</strong>
                    <span>{Object.values(policy.permissions).filter(Boolean).length}개 권한 사용</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3>기능 설정</h3>
              <ul className="feature-list">
                {(data?.features ?? []).map((f) => (
                  <li key={f.key}>
                    <span className={`status-dot ${on(f.enabled) ? "" : "status-dot-warning"}`} />
                    <strong>{f.label || f.key}</strong>
                    <button type="button" onClick={() => void update({ action: "feature", featureKey: f.key, enabled: !on(f.enabled) }).catch((cause) => setError(cause instanceof Error ? cause.message : "변경 사항을 저장하지 못했습니다."))}>
                      {on(f.enabled) ? "사용 중지" : "사용"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* 감사 로그는 읽기 전용이다. 이 화면에서 수정 경로를 열지 않는다. */}
            <div>
              <h3>변경 이력</h3>
              <ul className="audit-list">
                {(data?.audit ?? []).slice(0, 10).map((a) => (
                  <li key={a.id}>
                    <strong>{a.action}</strong>
                    <span>{a.actorEmail || "—"}</span>
                    <small>{a.createdAt ? new Date(a.createdAt).toLocaleString("ko-KR") : ""}</small>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
    </section>
  );
}
