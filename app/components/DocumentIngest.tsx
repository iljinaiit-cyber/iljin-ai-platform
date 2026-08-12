"use client";

import { useEffect, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { decodeDocumentText } from "../../lib/document-text";
import "./DocumentIngest.css";

type IngestedDocument = { assetId: string; jobId?: string | null; status: string; segmentCount?: number };
type Props = { onIndexed?: (document: IngestedDocument, indexedTitle: string) => void };
type QueuedFile = { id: string; file: File; status: "queued" | "uploading" | "embedding" | "done" | "failed"; error?: string };
type IngestMode = "upload" | "pc-folder" | "local-db";
type EmbeddingProgress = {
  assetId: string;
  title: string;
  status: string;
  stage?: string | null;
  processedChunks?: number | null;
  totalChunks?: number | null;
  errorMessage?: string | null;
  embeddingModel?: string | null;
};

const CLASSIFICATIONS = [
  { value: "internal", label: "내부", hint: "사내 구성원 열람" },
  { value: "confidential", label: "기밀", hint: "지정 부서만 열람" },
  { value: "public", label: "공개", hint: "전체 공개 가능" },
] as const;
const TEXT_LIKE = /\.(txt|md|markdown|csv|json|ya?ml|html?)$/i;
// 서버는 이미 PDF·이미지·오디오·비디오를 멀티모달로 처리한다(lib/multimodal.ts,
// getRagStatus().multimodalFormats). 여기서 막을 이유가 없다 — 텍스트류만 골라
// 본문 미리보기에 인라인으로 붙이고, 나머지는 그대로 큐에 넣어 서버가 변환한다.
const UPLOAD_ACCEPT = ".txt,.md,.markdown,.csv,.json,.yaml,.yml,.html,.htm,.pdf,.jpg,.jpeg,.png,.webp,.svg,.gif,.bmp,.wav,.mp3,.flac,.ogg,.m4a,.mp4,.mov,.webm,.mkv,audio/*,video/*,image/*";
const TERMINAL_STATUSES = new Set(["indexed", "failed"]);

function statusMessage(progress: EmbeddingProgress) {
  if (progress.status === "failed") return progress.errorMessage || "임베딩 처리에 실패했습니다.";
  if (progress.status === "indexed") return `${progress.processedChunks || progress.totalChunks || 0}개 청크 임베딩 완료${progress.embeddingModel ? ` · ${progress.embeddingModel}` : ""}`;
  if (progress.stage === "extracting") return "문서 내용 추출 중";
  if (progress.stage === "embedding") {
    return progress.totalChunks
      ? `임베딩 중 · ${progress.processedChunks || 0}/${progress.totalChunks} 청크`
      : "임베딩 준비 중";
  }
  return "임베딩 대기열에서 처리 대기 중";
}

function progressValue(progress: EmbeddingProgress) {
  if (progress.status === "indexed") return 100;
  if (!progress.totalChunks || progress.totalChunks < 1) return null;
  return Math.min(99, Math.round(((progress.processedChunks || 0) / progress.totalChunks) * 100));
}

export function DocumentIngest({ onIndexed }: Props) {
  const [mode, setMode] = useState<IngestMode>("upload");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [classification, setClassification] = useState<"public" | "internal" | "confidential">("internal");
  const [departmentScope, setDepartmentScope] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [progresses, setProgresses] = useState<EmbeddingProgress[]>([]);
  const [connectorEndpoint, setConnectorEndpoint] = useState("");
  const [databasePath, setDatabasePath] = useState("");
  const [databaseQuery, setDatabaseQuery] = useState("");

  const activeAssetIds = progresses.filter((item) => !TERMINAL_STATUSES.has(item.status)).map((item) => item.assetId).join(",");

  useEffect(() => {
    const assetIds = activeAssetIds ? activeAssetIds.split(",") : [];
    if (!assetIds.length) return;
    let disposed = false;
    const refresh = async () => {
      await Promise.all(assetIds.map(async (assetId) => {
        try {
          const response = await fetch(`/api/v1/assets/${assetId}`, { cache: "no-store" });
          if (!response.ok) return;
          const asset = await response.json() as {
            status?: string; index_stage?: string; processed_chunks?: number; total_chunks?: number;
            error_message?: string; embedding_model?: string;
          };
          if (disposed) return;
          setProgresses((current) => current.map((item) => item.assetId === assetId ? {
            ...item,
            status: asset.status || item.status,
            stage: asset.index_stage ?? item.stage,
            processedChunks: asset.processed_chunks ?? item.processedChunks,
            totalChunks: asset.total_chunks ?? item.totalChunks,
            errorMessage: asset.error_message ?? item.errorMessage,
            embeddingModel: asset.embedding_model ?? item.embeddingModel,
          } : item));
        } catch {
          // The next poll retries transient network errors without interrupting the upload view.
        }
      }));
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1500);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [activeAssetIds]);

  const trackEmbedding = (document: IngestedDocument, indexedTitle: string) => {
    setProgresses((current) => {
      const next: EmbeddingProgress = { assetId: document.assetId, title: indexedTitle, status: document.status };
      const existing = current.findIndex((item) => item.assetId === document.assetId);
      return existing < 0 ? [next, ...current].slice(0, 8) : current.map((item, index) => index === existing ? { ...item, ...next } : item);
    });
    onIndexed?.(document, indexedTitle);
  };

  const addFiles = (files: File[]) => setQueue((current) => {
    const known = new Set(current.map((item) => item.id));
    return [...current, ...files.map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}`, file, status: "queued" as const })).filter((item) => !known.has(item.id))];
  });

  const pickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    if (!files.length) return;
    addFiles(files);
    const file = files[0];
    setError("");
    if (TEXT_LIKE.test(file.name)) setContent(decodeDocumentText(await file.arrayBuffer()));
    if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ""));
    event.target.value = "";
  };

  const uploadFile = async (item: QueuedFile) => {
    setQueue((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "uploading", error: undefined } : entry));
    try {
      const form = new FormData();
      form.set("file", item.file);
      form.set("title", item.file.name.replace(/\.[^.]+$/, ""));
      form.set("classification", classification);
      form.set("department_scope", departmentScope);
      const response = await fetch("/api/v1/assets", { method: "POST", body: form });
      const payload = await response.json() as IngestedDocument & { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "문서를 등록하지 못했습니다.");
      const completed = payload.status === "indexed";
      setQueue((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: completed ? "done" : "embedding" } : entry));
      trackEmbedding(payload, item.file.name);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "문서를 등록하지 못했습니다.";
      setQueue((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "failed", error: message } : entry));
    }
  };

  const runQueue = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setDone("");
    for (const item of queue.filter((entry) => entry.status === "queued" || entry.status === "failed")) await uploadFile(item);
    setBusy(false);
    setDone("선택한 파일을 임베딩 대기열에 등록했습니다. 아래에서 실제 처리 현황을 확인할 수 있습니다.");
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles([...event.dataTransfer.files]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode !== "upload" || busy || !title.trim() || !content.trim()) return;
    setBusy(true);
    setError("");
    setDone("");
    try {
      const response = await fetch("/api/v1/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content, sourceType: "upload", classification, departmentScope: departmentScope.trim() ? departmentScope.split(",").map((department) => department.trim()).filter(Boolean) : undefined }),
      });
      const payload = await response.json() as IngestedDocument & { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "문서를 등록하지 못했습니다.");
      trackEmbedding(payload, title.trim());
      setDone(`"${title.trim()}" 문서를 임베딩 대기열에 등록했습니다.`);
      setTitle("");
      setContent("");
      setDepartmentScope("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "문서를 등록하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const registerLocalDb = async () => {
    if (busy || !connectorEndpoint.trim() || !databasePath.trim()) {
      setError("커넥터 주소와 로컬 DB 경로 또는 연결 이름을 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    setDone("");
    try {
      const response = await fetch("/api/v1/assets/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `로컬 DB · ${databasePath.trim()}`, source_type: "local-db", connection_config: { endpoint: connectorEndpoint.trim(), database: databasePath.trim(), query: databaseQuery.trim() || undefined, manifestMethod: "POST" }, schedule_interval_minutes: 5, classification, department_scope: departmentScope.trim() || "*" }),
      });
      const payload = await response.json() as { message?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "로컬 DB 연결을 등록하지 못했습니다.");
      setDone(`${payload.message || "로컬 DB 연결을 등록했습니다."} 첫 수집은 최대 5분 안에 시작됩니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로컬 DB 연결을 등록하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return <section className="ingest-panel" aria-label="문서 등록">
    <div className="ingest-head"><div><span className="section-kicker">DOCUMENT INGEST</span><h2>문서 등록</h2><p>파일, 개인 PC 폴더, 로컬 DB의 문서를 처리하고 임베딩 현황을 확인합니다.</p></div></div>
    <div className="ingest-mode-tabs" role="tablist" aria-label="문서 등록 방식">
      <button type="button" role="tab" aria-selected={mode === "upload"} className={mode === "upload" ? "is-active" : ""} onClick={() => setMode("upload")}>파일 업로드</button>
      <button type="button" role="tab" aria-selected={mode === "pc-folder"} className={mode === "pc-folder" ? "is-active" : ""} onClick={() => setMode("pc-folder")}>개인 PC 폴더</button>
      <button type="button" role="tab" aria-selected={mode === "local-db"} className={mode === "local-db" ? "is-active" : ""} onClick={() => setMode("local-db")}>로컬 DB</button>
    </div>

    <form className="ingest-form" onSubmit={submit}>
      {mode !== "local-db" ? <>
        <div className={`document-ingest__dropzone${dragging ? " is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
          <strong>{mode === "pc-folder" ? "PC 폴더를 선택하세요" : "여기로 문서를 끌어 놓으세요"}</strong>
          <span>{mode === "pc-folder" ? "브라우저에서 선택한 폴더의 파일을 일괄 업로드하고 자동 임베딩합니다." : "문서·PDF·이미지·오디오·비디오를 Object Storage에 보관한 뒤 Metadata Database와 Vectorize에 임베딩합니다."}</span>
          {mode === "pc-folder" ? <input type="file" multiple onChange={pickFile} aria-label="개인 PC 폴더 선택" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} /> : <input type="file" multiple accept={UPLOAD_ACCEPT} onChange={pickFile} aria-label="지식 데이터베이스 영구 등록 파일 선택" />}
        </div>
        {queue.length ? <ul className="document-ingest__queue">{queue.map((item) => <li key={item.id}><span>{item.file.name}</span><small data-status={item.status}>{item.status === "embedding" ? "임베딩 대기" : item.status}</small>{item.status === "failed" ? <button type="button" onClick={() => void uploadFile(item)}>다시 시도</button> : null}</li>)}</ul> : null}
        {queue.some((item) => item.status === "queued" || item.status === "failed") ? <button type="button" className="quiet-button" disabled={busy} onClick={() => void runQueue()}>{busy ? "업로드 중…" : mode === "pc-folder" ? "선택한 폴더 임베딩 시작" : "선택한 파일 업로드"}</button> : null}
      </> : <div className="local-db-card"><strong>로컬 DB 커넥터 연결</strong><p>SQLite·Postgres 등 로컬 DB를 읽는 커넥터의 HTTPS 주소를 입력하세요. Worker가 DB 자격증명을 직접 보관하지 않고 커넥터가 문서 매니페스트를 반환합니다.</p><label className="ingest-field">커넥터 HTTPS 주소<input value={connectorEndpoint} onChange={(event) => setConnectorEndpoint(event.target.value)} placeholder="https://your-connector.example.com/manifest" /></label><label className="ingest-field">DB 경로 또는 연결 이름<input value={databasePath} onChange={(event) => setDatabasePath(event.target.value)} placeholder="C:\\data\\knowledge.sqlite 또는 production-db" /></label><label className="ingest-field">조회문(선택)<textarea value={databaseQuery} onChange={(event) => setDatabaseQuery(event.target.value)} rows={4} placeholder="SELECT title, content FROM documents" /></label><button type="button" className="quiet-button" disabled={busy} onClick={() => void registerLocalDb()}>{busy ? "연결 등록 중…" : "로컬 DB 자동 임베딩 연결"}</button></div>}

      {mode === "upload" ? <><label className="ingest-field">문서 제목<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required placeholder="예: 해외출장비 지급기준 v4.2" /></label><label className="ingest-field">파일 선택 <small>(.txt .md .csv .json .yaml .html .pdf .jpg .png .wav .mp3 .mp4 .mov 등)</small><input type="file" accept={UPLOAD_ACCEPT} onChange={pickFile} /></label><label className="ingest-field">본문<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={8} required placeholder="텍스트류 문서는 파일을 선택하면 자동으로 채워지고, 직접 붙여 넣을 수도 있습니다. PDF·이미지·오디오·비디오는 본문 없이 아래 목록에서 바로 업로드하세요." /></label></> : null}
      <fieldset className="ingest-classification"><legend>문서 등급</legend>{CLASSIFICATIONS.map((item) => <label key={item.value}><input type="radio" name="classification" value={item.value} checked={classification === item.value} onChange={() => setClassification(item.value)} /><strong>{item.label}</strong><small>{item.hint}</small></label>)}</fieldset>
      <label className="ingest-field">열람 부서 <small>(쉼표 구분, 비우면 전체)</small><input value={departmentScope} onChange={(event) => setDepartmentScope(event.target.value)} placeholder="예: 생산기술팀, 재무보증팀" /></label>
      {mode === "pc-folder" ? <p className="ingest-hint">개인 PC 폴더 선택은 현재 등록을 위한 업로드 방식입니다. PC 폴더를 계속 동기화하려면 관리자 수집 소스에서 PC 커넥터를 추가해 주세요.</p> : null}
      {error ? <p className="ingest-error" role="alert">{error}</p> : null}
      {done ? <p className="ingest-done" role="status">{done}</p> : null}
      {mode === "upload" ? <button type="submit" className="primary-button" disabled={busy || !title.trim() || !content.trim()}>{busy ? "등록 요청 중…" : "임베딩 시작"}</button> : null}
    </form>

    {progresses.length ? <section className="embedding-progress" aria-live="polite" aria-label="임베딩 진행 현황">
      <div className="embedding-progress__head"><strong>임베딩 진행 현황</strong><span>{progresses.filter((item) => !TERMINAL_STATUSES.has(item.status)).length ? "처리 중" : "최신 상태"}</span></div>
      <ul>{progresses.map((item) => {
        const value = progressValue(item);
        return <li key={item.assetId} data-status={item.status}>
          <div><strong>{item.title}</strong><small>{statusMessage(item)}</small></div>
          <div className="embedding-progress__meter" role="progressbar" aria-label={`${item.title} 임베딩 진행률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}><span className={value === null ? "is-indeterminate" : ""} style={value === null ? undefined : { width: `${value}%` }} /></div>
        </li>;
      })}</ul>
    </section> : null}
  </section>;
}
