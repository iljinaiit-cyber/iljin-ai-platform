"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Corporation = {
  id: string; name: string; code: string | null;
  status: string; departmentCount: number; memberCount: number;
};
type Department = {
  id: string; corpId: string; parentId: string | null; name: string;
  code: string | null; status: string; memberCount: number; depth: number; path: string;
};
type ManagedUser = {
  email: string; display_name?: string; department?: string;
  corp_id?: string | null; dept_id?: string | null; role: string; status?: string;
};
type BudgetPolicy = { scope: string; scopeId: string; dailyLimit: number; updatedBy: string };
type BudgetUsage = {
  day: string; tenantSpent: number; tenantLimit: number; perUserLimit: number;
  topUsers: Array<{ email: string; spent: number }>;
};
type CloudCost = {
  period: string; capUsd: number; spentUsd: number; reservedUsd: number;
  cloudPaidCallsBlocked: boolean;
};

type OntologyStats = {
  entities: number; relations: number; mentions: number;
  byKind: Array<{ kind: string; count: number }>;
};

type Tab = "org" | "members" | "budget" | "graph";

const KIND_LABEL: Record<string, string> = {
  corporation: "법인", department: "부서", document_no: "문서번호",
  revision: "개정차수", standard: "규격", product: "제품",
  equipment: "설비", project: "프로젝트", date: "일자",
};

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || "요청을 처리하지 못했습니다.");
  return payload;
}

export function OrgConsole({ currentEmail }: { currentEmail: string }) {
  const [tab, setTab] = useState<Tab>("org");
  const [corporations, setCorporations] = useState<Corporation[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usage, setUsage] = useState<BudgetUsage>();
  const [cloudCost, setCloudCost] = useState<CloudCost>();
  const [policies, setPolicies] = useState<BudgetPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [graph, setGraph] = useState<OntologyStats>();
  const [graphQuery, setGraphQuery] = useState("");
  const [graphResult, setGraphResult] = useState<{
    seeds: Array<{ id: string; kind: string; canonicalName: string }>;
    neighbors: Array<{ id: string; kind: string; canonicalName: string; hop: number; mentionCount: number }>;
    segments: Array<{ segmentId: string; entityHits: number }>;
  }>();

  // 입력 상태
  const [corpName, setCorpName] = useState("");
  const [deptName, setDeptName] = useState("");
  const [deptCorp, setDeptCorp] = useState("");
  const [deptParent, setDeptParent] = useState("");
  const [filterCorp, setFilterCorp] = useState("");
  const [filterDept, setFilterDept] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [orgRes, govRes, budgetRes] = await Promise.all([
        fetch("/api/admin/organization", { cache: "no-store", signal }),
        fetch("/api/admin/governance", { cache: "no-store", signal }),
        fetch("/api/admin/budget", { cache: "no-store", signal }),
      ]);
      const org = await orgRes.json() as { corporations?: Corporation[]; departments?: Department[]; error?: { message?: string } };
      if (!orgRes.ok) throw new Error(org.error?.message || "조직 정보를 불러오지 못했습니다.");
      setCorporations(org.corporations ?? []);
      setDepartments(org.departments ?? []);

      const gov = await govRes.json() as { users?: ManagedUser[] };
      if (govRes.ok) setUsers(gov.users ?? []);

      const budget = await budgetRes.json() as { usage?: BudgetUsage; policies?: BudgetPolicy[]; cloudCost?: CloudCost };
      if (budgetRes.ok) { setUsage(budget.usage); setPolicies(budget.policies ?? []); setCloudCost(budget.cloudCost); }

      const ontoRes = await fetch("/api/admin/ontology", { cache: "no-store", signal });
      const onto = await ontoRes.json() as { stats?: OntologyStats };
      if (ontoRes.ok) setGraph(onto.stats);
      setError("");
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") {
        setError(cause instanceof Error ? cause.message : "조직 정보를 불러오지 못했습니다.");
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true); setError(""); setNotice("");
    try {
      await fn();
      await load();
      setNotice(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "요청을 처리하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const deptById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments],
  );

  const visibleUsers = useMemo(() => users.filter((u) => {
    if (filterCorp && u.corp_id !== filterCorp) return false;
    if (filterDept && u.dept_id !== filterDept) return false;
    return true;
  }), [users, filterCorp, filterDept]);

  const unassigned = users.filter((u) => !u.dept_id).length;

  return (
    <section className="panel governance-panel">
      <div className="panel-title">
        <div><span className="section-kicker">ORGANIZATION</span><h2>법인 · 부서 · 사용자</h2></div>
        <span>{currentEmail}</span>
      </div>

      <div className="auth-mode-switch" role="tablist">
        {([["org", "조직도"], ["members", `구성원 (${users.length})`], ["budget", "AI 사용량"], ["graph", "지식 그래프"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
            className={tab === id ? "selected" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {notice && <p className="agent-ops-note" role="status">{notice}</p>}
      {error && <p className="agent-ops-error" role="alert">{error}</p>}
      {loading ? <p className="agent-ops-note">불러오는 중…</p> : (
        <>
          {tab === "org" && (
            <div className="governance-grid">
              <div>
                <h3>법인 ({corporations.length})</h3>
                <form className="auth-form" onSubmit={(e) => {
                  e.preventDefault();
                  if (!corpName.trim()) return;
                  void run(() => postJson("/api/admin/organization",
                    { action: "create_corporation", name: corpName.trim() }),
                    `법인 '${corpName.trim()}'을 등록했습니다.`).then(() => setCorpName(""));
                }}>
                  <label><span>법인 추가</span>
                    <input value={corpName} onChange={(e) => setCorpName(e.target.value)}
                      maxLength={120} placeholder="예: 일진머티리얼즈" /></label>
                  <button className="button" type="submit" disabled={busy || !corpName.trim()}>등록</button>
                </form>
                <ul className="governance-list">
                  {corporations.map((c) => (
                    <li key={c.id}>
                      <strong>{c.name}</strong>
                      <small>부서 {c.departmentCount} · 인원 {c.memberCount}</small>
                    </li>
                  ))}
                  {!corporations.length && <li><small>등록된 법인이 없습니다.</small></li>}
                </ul>
              </div>

              <div>
                <h3>부서 ({departments.length})</h3>
                <form className="auth-form" onSubmit={(e) => {
                  e.preventDefault();
                  if (!deptCorp || !deptName.trim()) return;
                  void run(() => postJson("/api/admin/organization", {
                    action: "create_department", corpId: deptCorp,
                    name: deptName.trim(), parentId: deptParent || undefined,
                  }), `부서 '${deptName.trim()}'을 등록했습니다.`).then(() => setDeptName(""));
                }}>
                  <label><span>법인</span>
                    <select value={deptCorp} onChange={(e) => { setDeptCorp(e.target.value); setDeptParent(""); }}>
                      <option value="">선택</option>
                      {corporations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select></label>
                  <label><span>상위 부서 (선택)</span>
                    <select value={deptParent} onChange={(e) => setDeptParent(e.target.value)} disabled={!deptCorp}>
                      <option value="">법인 직속</option>
                      {departments.filter((d) => d.corpId === deptCorp).map((d) => (
                        <option key={d.id} value={d.id}>{d.path}</option>
                      ))}
                    </select></label>
                  <label><span>부서명</span>
                    <input value={deptName} onChange={(e) => setDeptName(e.target.value)}
                      maxLength={120} placeholder="예: DX전략팀" /></label>
                  <button className="button" type="submit" disabled={busy || !deptCorp || !deptName.trim()}>등록</button>
                </form>
                <ul className="governance-list">
                  {departments.map((d) => (
                    <li key={d.id} style={{ paddingLeft: `${d.depth * 16}px` }}>
                      <strong>{d.depth > 0 && "└ "}{d.name}</strong>
                      <small>인원 {d.memberCount}{d.status === "archived" ? " · 보관됨" : ""}</small>
                      {d.status !== "archived" && (
                        <button type="button" className="button" disabled={busy}
                          onClick={() => void run(
                            () => postJson("/api/admin/organization", { action: "archive_department", deptId: d.id }),
                            `'${d.name}' 및 하위 부서를 보관 처리했습니다.`)}>보관</button>
                      )}
                    </li>
                  ))}
                  {!departments.length && <li><small>등록된 부서가 없습니다.</small></li>}
                </ul>
              </div>
            </div>
          )}

          {tab === "members" && (
            <div>
              {unassigned > 0 && (
                <p className="agent-ops-note">조직 미배정 {unassigned}명 — 배정 전까지 조직 단위 한도가 적용되지 않습니다.</p>
              )}
              <div className="auth-form" style={{ flexDirection: "row", gap: "12px" }}>
                <label><span>법인</span>
                  <select value={filterCorp} onChange={(e) => { setFilterCorp(e.target.value); setFilterDept(""); }}>
                    <option value="">전체</option>
                    {corporations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></label>
                <label><span>부서</span>
                  <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
                    <option value="">전체</option>
                    {departments.filter((d) => !filterCorp || d.corpId === filterCorp)
                      .map((d) => <option key={d.id} value={d.id}>{d.path}</option>)}
                  </select></label>
              </div>
              <ul className="governance-list">
                {visibleUsers.map((u) => (
                  <li key={u.email}>
                    <strong>{u.display_name || u.email}</strong>
                    <small>{u.email} · {u.role}{u.status && u.status !== "approved" ? ` · ${u.status}` : ""}</small>
                    <select value={u.dept_id || ""} disabled={busy}
                      onChange={(e) => void run(() => postJson("/api/admin/organization", {
                        action: "assign_user", email: u.email,
                        deptId: e.target.value || null,
                        corpId: e.target.value ? deptById.get(e.target.value)?.corpId ?? null : null,
                      }), `${u.email} 소속을 변경했습니다.`)}>
                      <option value="">미배정</option>
                      {departments.filter((d) => d.status !== "archived")
                        .map((d) => <option key={d.id} value={d.id}>{d.path}</option>)}
                    </select>
                  </li>
                ))}
                {!visibleUsers.length && <li><small>해당 조건의 구성원이 없습니다.</small></li>}
              </ul>
            </div>
          )}

          {tab === "budget" && usage && (
            <div className="governance-grid">
              <div>
                {cloudCost && <>
                  <h3>Cloudflare AI monthly cost ({cloudCost.period})</h3>
                  <ul className="governance-list">
                    <li>
                      <strong>${cloudCost.spentUsd.toFixed(4)} / ${cloudCost.capUsd.toFixed(2)}</strong>
                      <small>
                        Reserved ${cloudCost.reservedUsd.toFixed(4)} · {cloudCost.cloudPaidCallsBlocked
                          ? "Paid Cloudflare calls blocked; local model only"
                          : "At $50, paid Cloudflare calls are blocked and requests fall back to local"}
                      </small>
                    </li>
                  </ul>
                </>}
                <h3>오늘 사용량 ({usage.day})</h3>
                <ul className="governance-list">
                  <li>
                    <strong>전사 {usage.tenantSpent.toLocaleString()} / {usage.tenantLimit.toLocaleString()}</strong>
                    <small>{Math.round((usage.tenantSpent / Math.max(1, usage.tenantLimit)) * 100)}% 소진 · 기본 사용자 한도 {usage.perUserLimit.toLocaleString()}</small>
                  </li>
                </ul>
                <h3>상위 사용자</h3>
                <ul className="governance-list">
                  {usage.topUsers.map((u) => (
                    <li key={u.email}><strong>{u.email}</strong><small>{u.spent.toLocaleString()}</small></li>
                  ))}
                  {!usage.topUsers.length && <li><small>오늘 사용 기록이 없습니다.</small></li>}
                </ul>
              </div>
              <div>
                <h3>조직별 한도</h3>
                <p className="agent-ops-note">
                  부서 값이 법인보다 우선합니다. 0 을 넣으면 오버라이드가 해제되고 기본값으로 돌아갑니다.
                </p>
                <ul className="governance-list">
                  {departments.filter((d) => d.status !== "archived").map((d) => {
                    const current = policies.find((p) => p.scope === "department" && p.scopeId === d.id);
                    return (
                      <li key={d.id}>
                        <strong>{d.path}</strong>
                        <small>{current ? `한도 ${current.dailyLimit.toLocaleString()}` : "기본값 적용"}</small>
                        <input type="number" min={0} max={1000000} defaultValue={current?.dailyLimit ?? 0}
                          disabled={busy} style={{ width: "110px" }}
                          onBlur={(e) => {
                            const next = Number(e.target.value);
                            if (next === (current?.dailyLimit ?? 0)) return;
                            void run(() => postJson("/api/admin/budget", {
                              scope: "department", scopeId: d.id, dailyLimit: next,
                            }), `'${d.name}' 한도를 변경했습니다.`);
                          }} />
                      </li>
                    );
                  })}
                  {!departments.length && <li><small>부서를 먼저 등록해 주세요.</small></li>}
                </ul>
              </div>
            </div>
          )}

          {tab === "graph" && (
            <div className="governance-grid">
              <div>
                <h3>온톨로지 현황</h3>
                <p className="agent-ops-note">
                  문서 색인 시 정규식·조직 사전으로 자동 추출합니다. LLM 호출이 없어 추가 비용이 들지 않습니다.
                </p>
                <ul className="governance-list">
                  <li><strong>엔티티 {(graph?.entities ?? 0).toLocaleString()}</strong>
                    <small>관계 {(graph?.relations ?? 0).toLocaleString()} · 언급 {(graph?.mentions ?? 0).toLocaleString()}</small></li>
                  {(graph?.byKind ?? []).map((k) => (
                    <li key={k.kind}><strong>{KIND_LABEL[k.kind] || k.kind}</strong><small>{k.count.toLocaleString()}</small></li>
                  ))}
                  {!graph?.entities && <li><small>아직 추출된 엔티티가 없습니다. 문서를 등록하면 채워집니다.</small></li>}
                </ul>
              </div>
              <div>
                <h3>그래프 탐색</h3>
                <form className="auth-form" onSubmit={(e) => {
                  e.preventDefault();
                  if (!graphQuery.trim()) return;
                  void run(async () => {
                    const res = await fetch(`/api/admin/ontology?q=${encodeURIComponent(graphQuery.trim())}`, { cache: "no-store" });
                    const payload = await res.json() as typeof graphResult & { error?: { message?: string } };
                    if (!res.ok) throw new Error(payload?.error?.message || "탐색에 실패했습니다.");
                    setGraphResult(payload);
                  }, "탐색을 완료했습니다.");
                }}>
                  <label><span>질의</span>
                    <input value={graphQuery} onChange={(e) => setGraphQuery(e.target.value)}
                      maxLength={200} placeholder="예: KS D 3698" /></label>
                  <button className="button" type="submit" disabled={busy || !graphQuery.trim()}>탐색</button>
                </form>
                {graphResult && (
                  <ul className="governance-list">
                    <li><strong>진입 엔티티 {graphResult.seeds.length}</strong>
                      <small>{graphResult.seeds.map((s) => s.canonicalName).join(", ") || "없음"}</small></li>
                    {graphResult.neighbors.slice(0, 15).map((n) => (
                      <li key={n.id}><strong>{n.canonicalName}</strong>
                        <small>{KIND_LABEL[n.kind] || n.kind} · {n.hop}홉 · 언급 {n.mentionCount}</small></li>
                    ))}
                    <li><strong>관련 세그먼트 {graphResult.segments.length}</strong>
                      <small>검색 시 이 세그먼트에 가산점이 적용됩니다.</small></li>
                  </ul>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
