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
  timeStartMs?: number;
  timeEndMs?: number;
};

// 오디오/비디오 시작·종료 타임코드를 Media Fragments URI(#t=)로 표현한다 —
// 브라우저 <audio>/<video> 가 표준으로 지원해 별도 플레이어 로직 없이 해당
// 구간으로 이동한다. https://www.w3.org/TR/media-frags/
function mediaFragmentUrl(url: string, timeStartMs?: number, timeEndMs?: number) {
  if (typeof timeStartMs !== "number") return url;
  const start = (timeStartMs / 1000).toFixed(1);
  const end = typeof timeEndMs === "number" && timeEndMs > timeStartMs ? `,${(timeEndMs / 1000).toFixed(1)}` : "";
  return `${url}#t=${start}${end}`;
}

function formatTimecode(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

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

function sourceHref(value?: string) {
  const raw = value?.trim().replace(/^<|>$/g, "");
  if (!raw) return undefined;
  if (raw.startsWith("/")) return raw;
  const candidate = raw.startsWith("//")
    ? `https:${raw}`
    : /^[a-z][a-z\d+.-]*:/i.test(raw)
      ? raw
      : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

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
      <h2>지식 검색 결과 · 인용 근거</h2>
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
            <li key={result.id || `${result.title}-${index}`} className={`rag-result${result.regionId ? " rag-document__visual" : ""}`}>
              <div className="rag-result-head">
                <span className={`rag-badge rag-badge--${result.sourceType}`}>
                  {SOURCE_BADGE[result.sourceType] ?? result.sourceType}
                </span>
                <h3>
                  {sourceHref(result.sourceUrl)
                    ? <a href={sourceHref(result.sourceUrl)} target={sourceHref(result.sourceUrl)?.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">{result.title}</a>
                    : result.title}
                </h3>
                {score ? <span className="rag-score" title="검색 관련도">{score}</span> : null}
              </div>

              {/* 인용문은 원문 그대로다. 요약하지 않는다 — 근거 검증이 목적이다. */}
              <p className="rag-snippet">{result.snippet}</p>
              {result.regionId ? <span className="rag-chip">이미지 근거 · {result.regionType || "visual"}</span> : null}
              {result.sourceType === "audio" && result.originalUrl
                ? <audio className="rag-media" controls preload="none" src={mediaFragmentUrl(result.originalUrl, result.timeStartMs, result.timeEndMs)} />
                : null}
              {result.sourceType === "video" && result.originalUrl
                ? <video className="rag-media" controls preload="none" src={mediaFragmentUrl(result.originalUrl, result.timeStartMs, result.timeEndMs)} />
                : null}
              {typeof result.timeStartMs === "number"
                ? <span className="rag-chip">{formatTimecode(result.timeStartMs)}{typeof result.timeEndMs === "number" ? ` – ${formatTimecode(result.timeEndMs)}` : ""}</span>
                : null}

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
