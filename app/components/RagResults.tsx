"use client";

import "./RagResults.css";

// AgentPortal 의 gatewayCitationToResult() 가 만들어 넣는 모양이 정본이다.
// 필드를 늘리려면 그 함수부터 고친다.
export type RagResultItem = {
  id: string;
  title: string;
  sourceType: "document" | "web" | "image" | "audio" | "video";
  snippet: string;
  citation?: string;
  score?: number;
  page?: number;
  section?: string;
  chunkId?: string;
  fileName?: string;
  sourceLabel?: string;
  sourceCategoryLabel?: string;
  updatedAt?: string;
  publishedAt?: string;
  version?: string;
  source?: string;
  sourceUrl?: string;
  citationId?: string;
  regionId?: string;
  regionType?: string;
  region?: unknown;
  originalUrl?: string;
};

type Props = {
  results: RagResultItem[];
  query: string;
  totalCount: number;
  elapsedMs?: number;
  // 호출부(AgentPortal)의 상태가 useState<string | null> 이라 null 이 온다.
  // 여기서 undefined 만 받으면 호출부가 매번 ?? undefined 를 붙여야 한다.
  traceId?: string | null;
  retrievalLabel?: string | null;
  accessLabel?: string | null;
  loading?: boolean;
  error?: string | null;
  emptyTitle: string;
  emptyDescription: string;
  onUseInChat?: (result: RagResultItem) => void;
};

const SOURCE_BADGE: Record<RagResultItem["sourceType"], string> = {
  document: "문서", web: "웹", image: "이미지", audio: "음성", video: "영상",
};

// 점수는 0~1 정규화 값이 들어온다. 사용자에게는 소수점보다 백분율이 읽기 쉽다.
const scoreLabel = (score?: number) =>
  typeof score === "number" && Number.isFinite(score) ? `${Math.round(score * 100)}%` : undefined;

export function RagResults({
  results, query, totalCount, elapsedMs, traceId, retrievalLabel, accessLabel,
  loading, error, emptyTitle, emptyDescription, onUseInChat,
}: Props) {
  if (loading) {
    return (
      <div className="rag-results rag-results--loading" role="status" aria-live="polite">
        <span className="rag-spinner" aria-hidden="true" />
        <p>근거를 검색하고 있습니다…</p>
      </div>
    );
  }

  if (error) {
    // What / Action / Trace 구조. 오류 원문을 그대로 보여주되 다음 행동을 함께 준다.
    return (
      <div className="rag-results rag-results--error" role="alert">
        <strong>검색을 완료하지 못했습니다.</strong>
        <p>{error}</p>
        <p className="rag-results-hint">검색어를 바꾸거나 잠시 후 다시 시도해 주세요.</p>
        {traceId ? <p className="rag-trace">TRACE · {traceId}</p> : null}
      </div>
    );
  }

  if (!results.length) {
    return (
      <div className="rag-results rag-results--empty">
        <strong>{emptyTitle}</strong>
        <p>{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="rag-results">
      <div className="rag-results-meta">
        <span><strong>{totalCount.toLocaleString("ko-KR")}</strong>건</span>
        {typeof elapsedMs === "number" ? <span>{elapsedMs.toLocaleString("ko-KR")}ms</span> : null}
        {retrievalLabel ? <span className="rag-chip">{retrievalLabel}</span> : null}
        {accessLabel ? <span className="rag-chip rag-chip--access">{accessLabel}</span> : null}
      </div>

      <ol className="rag-result-list">
        {results.map((result, index) => {
          const score = scoreLabel(result.score);
          const locator = [
            result.section,
            typeof result.page === "number" ? `p.${result.page}` : undefined,
          ].filter(Boolean).join(" · ");

          return (
            <li key={result.id || `${result.title}-${index}`} className="rag-result">
              <div className="rag-result-head">
                <span className={`rag-badge rag-badge--${result.sourceType}`}>
                  {SOURCE_BADGE[result.sourceType] ?? result.sourceType}
                </span>
                <h3>
                  {result.sourceUrl
                    ? <a href={result.sourceUrl} target={result.sourceUrl.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{result.title}</a>
                    : result.title}
                </h3>
                {score ? <span className="rag-score" title="검색 관련도">{score}</span> : null}
              </div>

              {/* 인용문은 원문 그대로다. 요약하지 않는다 — 근거 검증이 목적이다. */}
              <p className="rag-snippet">{result.snippet}</p>

              <div className="rag-result-foot">
                {locator ? <span>{locator}</span> : null}
                {result.sourceLabel ? <span>{result.sourceLabel}</span> : null}
                {result.version ? <span className="rag-version">{result.version}</span> : null}
                {result.updatedAt ? <span>{result.updatedAt}</span> : null}
                {result.originalUrl
                  ? <a className="text-button" href={result.originalUrl}>원문</a>
                  : null}
                {onUseInChat
                  ? <button type="button" className="text-button" onClick={() => onUseInChat(result)}>
                      대화에서 이어보기
                    </button>
                  : null}
              </div>
            </li>
          );
        })}
      </ol>

      {traceId ? <p className="rag-trace">TRACE · {traceId}{query ? ` · "${query}"` : ""}</p> : null}
    </div>
  );
}
