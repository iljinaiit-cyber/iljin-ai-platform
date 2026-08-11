"use client";

import { useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import "./DocumentIngest.css";

type IngestedDocument = { id: string; title: string; segmentCount?: number };
type Props = { onIndexed?: (document: IngestedDocument, indexedTitle: string) => void };
type QueuedFile = { id: string; file: File; status: "queued" | "uploading" | "done" | "failed"; error?: string };
type IngestMode = "upload" | "pc-folder" | "local-db";

const CLASSIFICATIONS = [
  { value: "internal", label: "내부용", hint: "사내 구성원 열람" },
  { value: "confidential", label: "기밀", hint: "지정 부서만 열람" },
  { value: "public", label: "공개", hint: "외부 공개 가능" },
] as const;
const TEXT_LIKE = /\.(txt|md|markdown|csv|json|ya?ml|html?)$/i;

export function DocumentIngest({ onIndexed }: Props) {
  const [mode, setMode] = useState<IngestMode>("upload");
  const [title, setTitle] = useState(""); const [content, setContent] = useState("");
  const [classification, setClassification] = useState<"public" | "internal" | "confidential">("internal");
  const [departmentScope, setDepartmentScope] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [done, setDone] = useState("");
  const [dragging, setDragging] = useState(false); const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [connectorEndpoint, setConnectorEndpoint] = useState(""); const [databasePath, setDatabasePath] = useState(""); const [databaseQuery, setDatabaseQuery] = useState("");

  const addFiles = (files: File[]) => setQueue((current) => {
    const known = new Set(current.map((item) => item.id));
    return [...current, ...files.map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}`, file, status: "queued" as const })).filter((item) => !known.has(item.id))];
  });

  const pickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]; if (!files.length) return;
    addFiles(files); const file = files[0]; setError("");
    if (TEXT_LIKE.test(file.name)) setContent(await file.text());
    if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ""));
    event.target.value = "";
  };

  const uploadFile = async (item: QueuedFile) => {
    setQueue((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "uploading", error: undefined } : entry));
    try {
      const form = new FormData(); form.set("file", item.file); form.set("title", item.file.name.replace(/\.[^.]+$/, "")); form.set("classification", classification); form.set("department_scope", departmentScope);
      const response = await fetch("/api/v1/assets", { method: "POST", body: form });
      const payload = await response.json() as IngestedDocument & { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "문서를 색인하지 못했습니다.");
      setQueue((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "done" } : entry)); onIndexed?.(payload, item.file.name);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "문서를 색인하지 못했습니다.";
      setQueue((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "failed", error: message } : entry));
    }
  };

  const runQueue = async () => {
    if (busy) return; setBusy(true); setError("");
    for (const item of queue.filter((entry) => entry.status === "queued" || entry.status === "failed")) await uploadFile(item);
    setBusy(false); setDone("PC 폴더 파일의 임베딩 요청을 완료했습니다.");
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); addFiles([...event.dataTransfer.files]); };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (mode !== "upload" || busy || !title.trim() || !content.trim()) return;
    setBusy(true); setError(""); setDone("");
    try {
      const response = await fetch("/api/v1/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim(), content, sourceType: "upload", classification, departmentScope: departmentScope.trim() ? departmentScope.split(",").map((d) => d.trim()).filter(Boolean) : undefined }) });
      const payload = await response.json() as IngestedDocument & { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "문서를 색인하지 못했습니다.");
      setDone(`"${title.trim()}" 색인을 시작했습니다.`); onIndexed?.(payload, title.trim()); setTitle(""); setContent(""); setDepartmentScope("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "문서를 색인하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const registerLocalDb = async () => {
    if (busy || !connectorEndpoint.trim() || !databasePath.trim()) { setError("커넥터 주소와 로컬 DB 경로 또는 연결 이름을 입력해 주세요."); return; }
    setBusy(true); setError(""); setDone("");
    try {
      const response = await fetch("/api/v1/assets/connectors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `로컬 DB · ${databasePath.trim()}`, source_type: "local-db", connection_config: { endpoint: connectorEndpoint.trim(), database: databasePath.trim(), query: databaseQuery.trim() || undefined, manifestMethod: "POST" }, schedule_interval_minutes: 5, classification, department_scope: departmentScope.trim() || "*" }) });
      const payload = await response.json() as { sourceId?: string; message?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "로컬 DB 연결을 등록하지 못했습니다.");
      setDone(payload.message || "로컬 DB 연결을 등록했습니다. 자동 수집 후 임베딩됩니다.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "로컬 DB 연결을 등록하지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <section className="ingest-panel" aria-label="문서 색인">
    <div className="ingest-head"><div><span className="section-kicker">DOCUMENT INGEST</span><h2>문서 색인</h2><p>파일, 개인 PC 폴더, 로컬 DB의 문서를 청킹·임베딩합니다.</p></div></div>
    <div className="ingest-mode-tabs" role="tablist" aria-label="문서 등록 방식">
      <button type="button" role="tab" aria-selected={mode === "upload"} className={mode === "upload" ? "is-active" : ""} onClick={() => setMode("upload")}>파일 업로드</button>
      <button type="button" role="tab" aria-selected={mode === "pc-folder"} className={mode === "pc-folder" ? "is-active" : ""} onClick={() => setMode("pc-folder")}>개인 PC 폴더</button>
      <button type="button" role="tab" aria-selected={mode === "local-db"} className={mode === "local-db" ? "is-active" : ""} onClick={() => setMode("local-db")}>로컬 DB</button>
    </div>

    <form className="ingest-form" onSubmit={submit}>
      {mode !== "local-db" ? <>
        <div className={`document-ingest__dropzone${dragging ? " is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
          <strong>{mode === "pc-folder" ? "PC 폴더를 선택하세요" : "여기에 문서를 놓으세요"}</strong>
          <span>{mode === "pc-folder" ? "브라우저에서 선택한 폴더의 파일을 일괄 업로드하고 자동 임베딩합니다." : "문서·PDF·이미지를 Object Storage에 보관하고 Metadata Database에 색인합니다."}</span>
          {mode === "pc-folder" ? <input type="file" multiple onChange={pickFile} aria-label="개인 PC 폴더 선택" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} /> : <input type="file" multiple onChange={pickFile} aria-label="지식베이스 영구 등록 파일 선택" />}
        </div>
        {queue.length ? <ul className="document-ingest__queue">{queue.map((item) => <li key={item.id}><span>{item.file.name}</span><small>{item.status}</small>{item.status === "failed" ? <button type="button" onClick={() => void uploadFile(item)}>재시도</button> : null}</li>)}</ul> : null}
        {mode === "pc-folder" ? <button type="button" className="quiet-button" disabled={busy || !queue.some((item) => item.status !== "done")} onClick={() => void runQueue()}>{busy ? "PC 폴더 업로드 중…" : "선택한 폴더 임베딩 시작"}</button> : null}
      </> : <div className="local-db-card"><strong>로컬 DB 커넥터 연결</strong><p>SQLite·Postgres 등 로컬 DB를 읽는 커넥터의 HTTPS 주소를 입력하세요. Worker가 DB 자격증명을 직접 보관하지 않고 커넥터가 문서 매니페스트를 반환합니다.</p><label className="ingest-field">커넥터 HTTPS 주소<input value={connectorEndpoint} onChange={(event) => setConnectorEndpoint(event.target.value)} placeholder="https://your-connector.example.com/manifest" /></label><label className="ingest-field">DB 경로 또는 연결 이름<input value={databasePath} onChange={(event) => setDatabasePath(event.target.value)} placeholder="C:\\data\\knowledge.sqlite 또는 production-db" /></label><label className="ingest-field">조회문(선택)<textarea value={databaseQuery} onChange={(event) => setDatabaseQuery(event.target.value)} rows={4} placeholder="SELECT title, content FROM documents" /></label><button type="button" className="quiet-button" disabled={busy} onClick={() => void registerLocalDb()}>{busy ? "연결 등록 중…" : "로컬 DB 자동 임베딩 연결"}</button></div>}

      {mode === "upload" ? <><label className="ingest-field">문서 제목<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required placeholder="예: 해외출장비 지급규정 v4.2" /></label><label className="ingest-field">파일 선택 <small>(.txt .md .csv .json .yaml .html)</small><input type="file" accept=".txt,.md,.markdown,.csv,.json,.yaml,.yml,.html,.htm" onChange={pickFile} /></label><label className="ingest-field">본문<textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} required placeholder="파일을 선택하거나 본문을 직접 붙여넣습니다." /></label></> : null}
      <fieldset className="ingest-classification"><legend>문서 등급</legend>{CLASSIFICATIONS.map((item) => <label key={item.value}><input type="radio" name="classification" value={item.value} checked={classification === item.value} onChange={() => setClassification(item.value)} /><strong>{item.label}</strong><small>{item.hint}</small></label>)}</fieldset>
      <label className="ingest-field">열람 부서 <small>(쉼표 구분, 비우면 전체)</small><input value={departmentScope} onChange={(e) => setDepartmentScope(e.target.value)} placeholder="예: 생산기술팀, 품질보증팀" /></label>
      {mode === "pc-folder" ? <p className="ingest-hint">개인 PC 폴더 선택은 현재 등록을 위한 업로드 사본입니다. PC가 계속 변경될 때는 관리자 수집 소스에서 PC 커넥터를 추가하세요.</p> : null}
      {error ? <p className="ingest-error" role="alert">{error}</p> : null}{done ? <p className="ingest-done" role="status">{done}</p> : null}
      {mode === "upload" ? <button type="submit" className="primary-button" disabled={busy || !title.trim() || !content.trim()}>{busy ? "색인 요청 중…" : "색인 시작"}</button> : null}
    </form>
  </section>;
}
