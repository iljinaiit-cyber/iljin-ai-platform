"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import "./DocumentIngest.css";

type IngestedDocument = { id: string; title: string; segmentCount?: number };
type Props = { onIndexed?: (document: IngestedDocument, indexedTitle: string) => void };

const CLASSIFICATIONS = [
  { value: "internal", label: "내부용", hint: "사내 구성원 열람" },
  { value: "confidential", label: "기밀", hint: "지정 부서만 열람" },
  { value: "public", label: "공개", hint: "외부 공개 가능" },
] as const;

// 텍스트로 읽을 수 있는 형식만 이 경로로 받는다. PDF·이미지는 색인 파이프라인이
// 별도로 추출하므로 여기서 브라우저가 억지로 문자열화하면 깨진 본문이 들어간다.
const TEXT_LIKE = /\.(txt|md|markdown|csv|json|ya?ml|html?)$/i;

export function DocumentIngest({ onIndexed }: Props) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [classification, setClassification] = useState<"public" | "internal" | "confidential">("internal");
  const [departmentScope, setDepartmentScope] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const pickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    if (!TEXT_LIKE.test(file.name)) {
      setError("현재 화면은 텍스트 계열 파일(.txt .md .csv .json .yaml .html)만 받습니다. 그 외 형식은 관리자 수집 경로를 이용해 주세요.");
      event.target.value = "";
      return;
    }
    setContent(await file.text());
    if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ""));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !title.trim() || !content.trim()) return;
    setBusy(true);
    setError("");
    setDone("");
    try {
      const response = await fetch("/api/v1/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          content,
          sourceType: "upload",
          classification,
          // 빈 값이면 서버가 기본 범위('*')를 쓴다. 여기서 임의로 넓히지 않는다.
          departmentScope: departmentScope.trim()
            ? departmentScope.split(",").map((d) => d.trim()).filter(Boolean)
            : undefined,
        }),
      });
      const payload = await response.json() as IngestedDocument & { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "문서를 색인하지 못했습니다.");
      setDone(`"${title.trim()}" 색인을 시작했습니다.`);
      onIndexed?.(payload, title.trim());
      setTitle("");
      setContent("");
      setDepartmentScope("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "문서를 색인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ingest-panel" aria-label="문서 색인">
      <div className="ingest-head">
        <div>
          <span className="section-kicker">DOCUMENT INGEST</span>
          <h2>문서 색인</h2>
          <p>업로드한 문서는 청킹·임베딩 후 검색 근거로 사용됩니다.</p>
        </div>
      </div>

      <form className="ingest-form" onSubmit={submit}>
        <label className="ingest-field">
          문서 제목
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required placeholder="예: 해외출장비 지급규정 v4.2" />
        </label>

        <label className="ingest-field">
          파일 선택 <small>(.txt .md .csv .json .yaml .html)</small>
          <input type="file" accept=".txt,.md,.markdown,.csv,.json,.yaml,.yml,.html,.htm" onChange={pickFile} />
        </label>

        <label className="ingest-field">
          본문
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} required placeholder="파일을 선택하거나 본문을 직접 붙여넣습니다." />
        </label>

        <fieldset className="ingest-classification">
          <legend>문서 등급</legend>
          {CLASSIFICATIONS.map((item) => (
            <label key={item.value}>
              <input
                type="radio"
                name="classification"
                value={item.value}
                checked={classification === item.value}
                onChange={() => setClassification(item.value)}
              />
              <strong>{item.label}</strong>
              <small>{item.hint}</small>
            </label>
          ))}
        </fieldset>

        <label className="ingest-field">
          열람 부서 <small>(쉼표 구분, 비우면 전체)</small>
          <input value={departmentScope} onChange={(e) => setDepartmentScope(e.target.value)} placeholder="예: 생산기술팀, 품질보증팀" />
        </label>

        {error ? <p className="ingest-error" role="alert">{error}</p> : null}
        {done ? <p className="ingest-done" role="status">{done}</p> : null}

        <button type="submit" className="primary-button" disabled={busy || !title.trim() || !content.trim()}>
          {busy ? "색인 요청 중…" : "색인 시작"}
        </button>
      </form>
    </section>
  );
}
