"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import "./IngestionSources.css";

type SourceType = "r2-folder" | "http-server" | "file-link" | "network-folder" | "pc-folder" | "local-db";
type Source = {
  id: string; name?: string; source_type?: SourceType | string; connection_config?: string;
  enabled?: number | boolean; schedule_interval_minutes?: number;
  last_run_at?: string; last_run_status?: string; last_run_summary?: string; total_ingested?: number;
};
type FormState = {
  name: string; sourceType: SourceType; links: string; endpoint: string; path: string; prefix: string;
  database: string; query: string; method: "GET" | "POST"; scheduleMinutes: string; classification: "public" | "internal" | "confidential"; departmentScope: string;
};
const SOURCE_LABELS: Record<SourceType, string> = {
  "file-link": "파일 링크", "network-folder": "네트워크 폴더", "pc-folder": "PC 폴더", "local-db": "로컬 DB", "http-server": "HTTP 매니페스트", "r2-folder": "R2 폴더",
};
const emptyForm: FormState = { name: "", sourceType: "file-link", links: "", endpoint: "", path: "", prefix: "", database: "", query: "", method: "GET", scheduleMinutes: "360", classification: "internal", departmentScope: "*" };

function configFor(source: Source) { try { return JSON.parse(source.connection_config || "{}") as Record<string, unknown>; } catch { return {}; } }
function sourceDetail(source: Source) {
  const config = configFor(source);
  if (source.source_type === "file-link") { const urls = Array.isArray(config.urls) ? config.urls : config.url ? [config.url] : []; return `${urls.length}개 링크`; }
  if (source.source_type === "r2-folder") return typeof config.prefix === "string" && config.prefix ? `R2/${config.prefix}` : "R2 전체";
  const endpoint = typeof config.endpoint === "string" ? config.endpoint : "매니페스트 미설정";
  return `${endpoint}${typeof config.path === "string" && config.path ? ` · ${config.path}` : ""}`;
}

export function IngestionSources() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [busyId, setBusyId] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm); const [showForm, setShowForm] = useState(false); const [saving, setSaving] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/admin/ingestion-sources", { cache: "no-store", signal });
      const payload = await response.json() as { sources?: Source[]; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "수집 소스를 불러오지 못했습니다.");
      setSources(payload.sources ?? []); setError("");
    } catch (cause) { if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "수집 소스를 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void Promise.resolve().then(() => load(controller.signal)); return () => controller.abort(); }, [load]);
  const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (saving) return;
    const sourceType = form.sourceType; const links = form.links.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean);
    const connectionConfig = sourceType === "file-link" ? { urls: links } : sourceType === "r2-folder" ? { prefix: form.prefix } : sourceType === "local-db" ? { endpoint: form.endpoint.trim(), database: form.database.trim(), query: form.query.trim() || undefined, manifestMethod: form.method } : { endpoint: form.endpoint.trim(), path: form.path.trim() || undefined, manifestMethod: form.method };
    if (!form.name.trim()) { setError("소스 이름을 입력해 주세요."); return; }
    if (sourceType === "file-link" && !links.length) { setError("파일 링크를 한 줄에 하나씩 입력해 주세요."); return; }
    if (sourceType !== "r2-folder" && sourceType !== "file-link" && !form.endpoint.trim()) { setError("매니페스트 엔드포인트를 입력해 주세요."); return; }
    if ((sourceType === "network-folder" || sourceType === "pc-folder") && !form.path.trim()) { setError("동기화할 폴더 경로를 입력해 주세요."); return; }
    if (sourceType === "local-db" && !form.database.trim()) { setError("로컬 DB 경로 또는 연결 이름을 입력해 주세요."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/admin/ingestion-sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name.trim(), source_type: sourceType, connection_config: connectionConfig, schedule_interval_minutes: Number(form.scheduleMinutes), classification: form.classification, department_scope: form.departmentScope.trim() || "*" }) });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "수집 소스를 등록하지 못했습니다.");
      setForm(emptyForm); setShowForm(false); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "수집 소스를 등록하지 못했습니다."); }
    finally { setSaving(false); }
  };
  const toggle = async (source: Source) => {
    if (busyId) return; setBusyId(source.id);
    try {
      const response = await fetch("/api/admin/ingestion-sources", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: source.id, enabled: !(source.enabled === true || source.enabled === 1) }) });
      if (!response.ok) { const payload = await response.json() as { error?: { message?: string } }; throw new Error(payload.error?.message || "설정을 변경하지 못했습니다."); }
      void load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "설정을 변경하지 못했습니다."); }
    finally { setBusyId(""); }
  };
  const run = async (source: Source) => {
    if (busyId) return; setBusyId(source.id);
    try {
      const response = await fetch("/api/admin/ingestion-sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run", id: source.id }) });
      if (!response.ok) { const payload = await response.json() as { error?: { message?: string } }; throw new Error(payload.error?.message || "수집을 실행하지 못했습니다."); }
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "수집을 실행하지 못했습니다."); }
    finally { setBusyId(""); }
  };
  const formHint = useMemo(() => {
    if (form.sourceType === "file-link") return "공개 또는 인증된 HTTP(S) 파일 URL을 한 줄에 하나씩 입력합니다.";
    if (form.sourceType === "r2-folder") return "R2 객체 prefix를 기준으로 새 파일을 찾아 임베딩합니다.";
    if (form.sourceType === "pc-folder") return "PC 폴더를 읽는 로컬 커넥터의 HTTPS 매니페스트 주소가 필요합니다. 브라우저가 닫혀도 동작합니다.";
    if (form.sourceType === "network-folder") return "SMB/UNC 경로를 직접 읽지 않고, 사내 커넥터가 매니페스트로 노출한 경로를 동기화합니다.";
    return "엔드포인트는 { files: [{ url, title?, mimeType? }] } 또는 배열을 반환해야 합니다.";
  }, [form.sourceType]);
  return <section className="panel ingestion-panel">
    <div className="panel-title"><div><span className="section-kicker">INGESTION</span><h2>수집 소스</h2></div><div className="ingestion-title-actions"><span>{sources.length}개</span><button type="button" className="button button-primary ingestion-add-button" onClick={() => { setShowForm((value) => !value); setError(""); }}>{showForm ? "닫기" : "+ 소스 추가"}</button></div></div>
    {showForm ? <form className="source-form" onSubmit={(event) => void submit(event)}>
      <div className="source-form-grid">
        <label>소스 이름<input value={form.name} onChange={(event) => updateForm("name", event.target.value)} placeholder="예: 설계 문서 링크" maxLength={120} /></label>
        <label>소스 유형<select value={form.sourceType} onChange={(event) => updateForm("sourceType", event.target.value as SourceType)}>{Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>자동 수집 주기(분)<input type="number" min={5} max={10080} value={form.scheduleMinutes} onChange={(event) => updateForm("scheduleMinutes", event.target.value)} /></label>
        <label>분류<select value={form.classification} onChange={(event) => updateForm("classification", event.target.value as FormState["classification"])}><option value="public">공개</option><option value="internal">내부</option><option value="confidential">기밀</option></select></label>
      </div>
      {form.sourceType === "file-link" ? <label>파일 링크<textarea value={form.links} onChange={(event) => updateForm("links", event.target.value)} placeholder="https://example.com/manual.pdf\nhttps://example.com/policy.md" rows={3} /></label> : null}
      {form.sourceType === "r2-folder" ? <label>R2 prefix<input value={form.prefix} onChange={(event) => updateForm("prefix", event.target.value)} placeholder="knowledge/" /></label> : null}
      {form.sourceType !== "file-link" && form.sourceType !== "r2-folder" ? <><label>매니페스트 엔드포인트<input value={form.endpoint} onChange={(event) => updateForm("endpoint", event.target.value)} placeholder="https://connector.example.com/manifest" /></label>{form.sourceType === "local-db" ? <><label>DB 경로 또는 연결 이름<input value={form.database} onChange={(event) => updateForm("database", event.target.value)} placeholder="production-db 또는 C:\\data\\knowledge.sqlite" /></label><label>조회문(선택)<textarea value={form.query} onChange={(event) => updateForm("query", event.target.value)} rows={3} placeholder="SELECT title, content FROM documents" /></label></> : form.sourceType !== "http-server" ? <label>{form.sourceType === "pc-folder" ? "PC 폴더 경로" : "네트워크 폴더 경로"}<input value={form.path} onChange={(event) => updateForm("path", event.target.value)} placeholder={form.sourceType === "pc-folder" ? "C:\\Knowledge" : "\\\\server\\share\\knowledge"} /></label> : null}<label>매니페스트 요청<select value={form.method} onChange={(event) => updateForm("method", event.target.value as FormState["method"])}><option value="GET">GET + path 쿼리</option><option value="POST">POST JSON</option></select></label></> : null}
      <label>부서 범위<input value={form.departmentScope} onChange={(event) => updateForm("departmentScope", event.target.value)} placeholder="* 또는 설계,품질" /></label>
      <p className="source-form-hint">{formHint}</p><div className="source-form-actions"><button type="submit" className="primary-button" disabled={saving}>{saving ? "등록 중…" : "자동 임베딩 연결"}</button><button type="button" className="text-button" onClick={() => setShowForm(false)}>취소</button></div>
    </form> : null}
    {loading ? <p className="agent-ops-note">불러오는 중…</p> : error ? <p className="agent-ops-error" role="alert">{error}</p> : !sources.length ? <p className="agent-ops-note">등록된 수집 소스가 없습니다. 소스 추가에서 링크나 폴더 커넥터를 연결하세요.</p> : <ul className="source-list">{sources.map((source) => { const enabled = source.enabled === true || source.enabled === 1; const sourceType = source.source_type as SourceType; return <li key={source.id} className="source-row"><span className={`status-dot ${enabled ? "" : "status-dot-warning"}`} /><div><strong>{source.name || source.id}</strong><small>{SOURCE_LABELS[sourceType] || source.source_type || "—"} · {sourceDetail(source)}</small><small>{source.last_run_status ? `최근 실행: ${source.last_run_status}` : "아직 실행되지 않음"}{source.total_ingested ? ` · 누적 ${source.total_ingested}건` : ""}</small>{source.last_run_summary ? <small className="source-summary">{source.last_run_summary}</small> : null}</div><div className="source-meta">{source.schedule_interval_minutes ? <span className="mono">매 {source.schedule_interval_minutes}분</span> : null}{source.last_run_at ? <span>{new Date(source.last_run_at).toLocaleString("ko-KR")}</span> : null}</div><button type="button" className="text-button" disabled={busyId === source.id} onClick={() => void run(source)}>지금 실행</button><button type="button" className="text-button" disabled={busyId === source.id} onClick={() => void toggle(source)}>{busyId === source.id ? "변경 중…" : enabled ? "중지" : "사용"}</button></li>; })}</ul>}
  </section>;
}
