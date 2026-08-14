"use client";

import {
  DragEvent as ReactDragEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import { RagResults, type RagResultItem } from "./components/RagResults";
import { DocumentIngest } from "./components/DocumentIngest";
import { AgentTasksView, ToolApprovalsView } from "./components/AgentOperations";
import { AdminGovernance } from "./components/AdminGovernance";
import { OrgConsole } from "./components/OrgConsole";
import { AiControlTower } from "./components/AiControlTower";
import { RequirementsChecklist } from "./components/RequirementsChecklist";
import { IngestionSources } from "./components/IngestionSources";
import { InternetSearchOperations } from "./components/InternetSearchOperations";
import { PlatformOperationsConsole } from "./components/PlatformOperationsConsole";
import { SystemArchitectureMonitor } from "./components/SystemArchitectureMonitor";
import { FeedbackBoard } from "./components/FeedbackBoard";
import "./page-display.css";
import "./industrial-layout.css";
import { COMPANY_NAME } from "../lib/company-profile";

type View = "home" | "chat" | "search" | "tasks" | "approvals" | "activity" | "schedule" | "feedback" | "admin";
type Scope = "personal" | "department";
type ChatSensitivity = "public" | "internal" | "confidential";
type SearchScope = "internal" | "internet";
type ChatAnswerLength = "brief" | "standard" | "detailed";
type ChatReasoningTier = "swift" | "expert" | "deep";

const DEFAULT_DEPARTMENT = "IT개발2팀";

const GENERATION_STAGES: Record<SearchScope, string[]> = {
  internet: ["질문·의도 분석 중", "대화 맥락 확인 중", "웹 검색 중", "검색 결과 교차 검토 중", "근거 기반 답변 작성 중"],
  internal: ["질문·의도 분석 중", "대화 맥락 확인 중", "사내 문서 검색 중", "근거 확인 중", "근거 기반 답변 작성 중"],
};

function generationStageIndex(scope: SearchScope, stage: string) {
  const stages = GENERATION_STAGES[scope];
  const exactIndex = stages.indexOf(stage);
  if (exactIndex >= 0) return exactIndex;
  if (/검색 결과|근거 확인|요약|상세 답변|작성/.test(stage)) return stages.length - 1;
  if (/맥락|기억/.test(stage)) return 1;
  if (/검색/.test(stage)) return 2;
  return 0;
}

function formatElapsed(ms: number) {
  return ms >= 1_000 ? `${(ms / 1_000).toFixed(1)}초` : `${ms}ms`;
}

function sourceDomain(url?: string) {
  if (!url) return "출처 링크";
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "출처 링크"; }
}

function citationHref(value?: string) {
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

function formatSearchDate(value?: string) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value.slice(0, 40) : new Date(timestamp).toLocaleDateString("ko-KR");
}

async function readApiPayload<T>(response: Response): Promise<T & { error?: { message?: string } }> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T & { error?: { message?: string } };
  } catch {
    throw new Error(response.ok
      ? "서버 응답을 읽을 수 없습니다. 잠시 후 다시 시도해 주세요."
      : `서버 오류가 발생했습니다. (${response.status}) 잠시 후 다시 시도해 주세요.`);
  }
}

function internetProviderLabel(provider?: string) {
  if (provider === "tavily") return "Tavily 본문 검색";
  if (provider === "exa") return "Exa 의미 검색";
  if (provider === "google") return "Google 웹 검색";
  if (provider === "naver") return "NAVER 웹·뉴스 검색";
  if (provider === "youtube") return "YouTube 동영상 검색";
  if (provider === "brave") return "Brave 확장 검색";
  if (provider === "webpilot") return "WebPilot 호환 검색";
  if (provider === "duckduckgo") return "DuckDuckGo 웹 검색";
  if (provider === "jina") return "Jina AI 의미 검색";
  return "Wikimedia 참고 출처";
}

function internetProvidersSummary(providers?: string[]) {
  if (!providers || providers.length === 0) return undefined;
  if (providers.length === 1) return internetProviderLabel(providers[0]);
  return `${providers.map((provider) => internetProviderLabel(provider).replace(/\s.+$/, "")).join("·")} 종합 (${providers.length}개 출처)`;
}

type CitationLookup = Map<string, { url?: string; title: string }>;

function shortenCitationFilename(value: string) {
  const filename = value.trim();
  return filename.length > 48 ? `${filename.slice(0, 48)}…` : filename;
}

function buildCitationLookup(citations?: RagResultItem[]): CitationLookup {
  if (!citations?.length) return new Map();
  return new Map(citations.map((c) => [`[${c.citationId || c.id}]`, { url: citationHref(c.sourceUrl), title: c.fileName || c.title }]));
}

function inlineAnswerContent(text: string, keyPrefix: string, citations?: CitationLookup): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\[(?:W|S)\d+\]|\[[^\]]+\]\([^)]+\)|---)/g)
    .filter(Boolean)
    .map((part, index) => {
      const key = `${keyPrefix}-${index}`;
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={key}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={key}>{part.slice(1, -1)}</code>;
      }
      if (/^\[(?:W|S)\d+\]$/.test(part)) {
        if (/^\[W\d+\]$/.test(part)) return null;
        const ref = citations?.get(part);
        const label = ref?.title ? shortenCitationFilename(ref.title) : part;
        if (ref?.url) {
          return (
            <a key={key} href={ref.url} target="_blank" rel="noreferrer" className="answer-citation" title={ref.title}>
              {label}
            </a>
          );
        }
        return <span className="answer-citation" key={key}>{label}</span>;
      }
      if (part === "---") {
        return <hr key={key} className="answer-divider" />;
      }
      const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const href = citationHref(linkMatch[2]);
        if (!href) return part;
        return (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {linkMatch[1]}
          </a>
        );
      }
      return part;
    });
}

function tableCells(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableDivider(line: string) {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function FormattedAnswer({ content, citations }: { content: string; citations?: CitationLookup }) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const Heading = heading[1].length === 1 ? "h2" : "h3";
      blocks.push(<Heading key={`heading-${index}`}>{inlineAnswerContent(heading[2], `heading-${index}`, citations)}</Heading>);
      index += 1;
      continue;
    }

    if (/^---+$/.test(line)) {
      blocks.push(<hr key={`hr-${index}`} className="answer-divider" />);
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && line.includes("|") && isTableDivider(lines[index + 1])) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      blocks.push(
        <div className="answer-table-wrap" key={`table-${index}`}>
          <table>
            <thead><tr>{headers.map((cell, cellIndex) => <th key={`header-${cellIndex}`}>{inlineAnswerContent(cell, `header-${cellIndex}`, citations)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => <tr key={`row-${rowIndex}`}>{headers.map((_, cellIndex) => <td key={`cell-${rowIndex}-${cellIndex}`}>{inlineAnswerContent(row[cellIndex] || "", `cell-${rowIndex}-${cellIndex}`, citations)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const items: string[] = [];
      const orderedList = Boolean(ordered);
      while (index < lines.length) {
        const item = lines[index].trim().match(orderedList ? /^\d+[.)]\s+(.+)$/ : /^[-*]\s+(.+)$/);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      const children = items.map((item, itemIndex) => <li key={`item-${itemIndex}`}>{inlineAnswerContent(item, `item-${itemIndex}`, citations)}</li>);
      blocks.push(orderedList ? <ol key={`list-${index}`}>{children}</ol> : <ul key={`list-${index}`}>{children}</ul>);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      const current = lines[index].trim();
      const next = lines[index + 1]?.trim() || "";
      if (paragraph.length && (/^(#{1,3})\s+/.test(current) || /^[-*]\s+/.test(current) || /^\d+[.)]\s+/.test(current))) break;
      if (paragraph.length && current.includes("|") && isTableDivider(next)) break;
      paragraph.push(current);
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${index}`}>
        {paragraph.map((paragraphLine, lineIndex) => (
          <span key={`line-${lineIndex}`}>
            {inlineAnswerContent(paragraphLine, `paragraph-${index}-${lineIndex}`, citations)}
            {lineIndex < paragraph.length - 1 && <br />}
          </span>
        ))}
      </p>,
    );
  }

  return <div className="message-content">{blocks}</div>;
}

const kstDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});

const kstTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

type AssetUploadResponse = {
  assetId?: string;
  jobId?: string | null;
  status?: "indexed" | "queued" | "failed";
  segmentCount?: number;
  multimodal?: { modality?: string };
  error?: { message?: string };
};

// Rejections raised before the route handler runs (413 body-size limit, edge
// errors) have plain-text bodies, so parsing unconditionally would surface a raw
// "Unexpected token" syntax error instead of an actionable message.
async function readUploadResponse(response: Response): Promise<AssetUploadResponse> {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) as AssetUploadResponse : {};
  } catch {
    if (response.status === 413) {
      return { error: { message: "파일이 너무 커서 업로드하지 못했습니다. 더 작은 파일로 나눠 첨부해 주세요." } };
    }
    return { error: { message: body.trim().slice(0, 200) || `문서를 등록하지 못했습니다. (HTTP ${response.status})` } };
  }
}

type AssetStatusResponse = {
  status?: "queued" | "indexing" | "indexed" | "failed";
  segment_count?: number;
  processed_chunks?: number;
  total_chunks?: number;
  error_message?: string;
};

type ConversationAttachmentItem = {
  asset_id: string;
  title: string;
  mime_type: string;
  status: "queued" | "indexing" | "indexed" | "failed";
  segment_count: number;
  retention: "temporary";
  created_at: string;
};

// Large uploads are indexed asynchronously by the Cloudflare Queue consumer
// (see indexer/worker.ts). ~200 chunks/window; poll slowly enough to stay well
// under Cloudflare's per-route rate limit for a document that takes minutes.
const ASSET_POLL_INTERVAL_MS = 4_000;
const ASSET_POLL_TIMEOUT_MS = 30 * 60 * 1_000;

function describeAssetProgress(payload: AssetStatusResponse) {
  if (payload.total_chunks) {
    return `${payload.processed_chunks || 0}/${payload.total_chunks} 조각 색인 중`;
  }
  return "문서를 분석하고 있습니다";
}

type ApiStatus = {
  state: "checking" | "ready" | "configuration" | "offline";
  label: string;
  detail: string;
};

type AccessUser = {
  email: string;
  displayName: string;
  tenantId: string;
  department: string;
  corpId: string | null;
  deptId: string | null;
  role: "user" | "manager" | "admin";
  status: "unrequested" | "pending" | "approved" | "rejected";
  approvalRequestedAt?: string;
  applicationNote?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  permissions?: string[];
  features?: Record<string, boolean>;
};

type AccessState =
  | { state: "checking" }
  | { state: "signed_out" }
  | { state: "approved"; user: AccessUser }
  | { state: "unrequested" | "pending" | "rejected"; user: AccessUser }
  | { state: "error"; message: string; traceId?: string; retryAfter?: number };

type ThemeColor = "blue" | "violet" | "emerald" | "amber" | "rose" | "slate" | "indigo" | "cyan";
type ThemeMode = "light" | "dark" | "system";

const themeColorOptions: Array<{ value: ThemeColor; label: string }> = [
  { value: "blue", label: "기본 블루" },
  { value: "violet", label: "바이올렛" },
  { value: "emerald", label: "에메랄드" },
  { value: "amber", label: "앰버" },
  { value: "rose", label: "로즈" },
  { value: "slate", label: "슬레이트" },
  { value: "indigo", label: "인디고" },
  { value: "cyan", label: "시안" },
];

function isThemeColor(value: string | null): value is ThemeColor {
  return value === "blue" || value === "violet" || value === "emerald" || value === "amber" || value === "rose" || value === "slate" || value === "indigo" || value === "cyan";
}

type FollowUpQuestion = { question: string; intent: string };
type ChatAgent = { id: string; name: string; instructions: string };

type ChatMessage = {
  role: "user" | "assistant";
  body: string;
  requestBody?: string;
  messageId?: string;
  feedback?: 1 | -1;
  provider?: string;
  model?: string;
  traceId?: string;
  latencyMs?: number;
  error?: boolean;
  streamingResponse?: boolean;
  streamingStage?: string;
  streamingDetail?: string;
  streamingSummary?: string;
  tokenCount?: number;
  citations?: RagResultItem[];
  followUpQuestions?: FollowUpQuestion[];
  relatedQuestions?: FollowUpQuestion[];
  clarificationRequired?: boolean;
  clarificationOriginalQuestion?: string;
};

function GenerationProgress({ scope, stage, detail, elapsedMs = 0, tokenCount, sources = [] }: { scope: SearchScope; stage: string; detail?: string; elapsedMs?: number; tokenCount?: number; sources?: RagResultItem[] }) {
  const stages = GENERATION_STAGES[scope];
  const activeIndex = generationStageIndex(scope, stage);
  const progress = ((activeIndex + 1) / stages.length) * 100;
  return (
    <section className="generation-progress" aria-label="답변 생성 진행 단계" aria-live="polite">
      <div className="generation-progress__heading">
        <div>
          <span className="generation-progress__eyebrow">답변 생성 진행</span>
          <strong>{stage}</strong>
        </div>
        <div className="generation-progress__metrics">
          <span className="generation-progress__live"><i aria-hidden="true" />실시간 처리</span>
          <span>{tokenCount?.toLocaleString() ?? "토큰 계산 중"} · {formatElapsed(elapsedMs)}</span>
          <b>{activeIndex + 1}/{stages.length}</b>
        </div>
      </div>
      {detail && <p className="generation-progress__detail" aria-live="polite">{detail}</p>}
      <div className="generation-progress__bar" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
      <ol className="generation-progress__steps">
        {stages.map((label, index) => (
          <li key={label} className={index < activeIndex ? "is-complete" : index === activeIndex ? "is-active" : "is-pending"}>
            <span className="generation-progress__marker" aria-hidden="true" />
            <span>{label.replace(/ 중$/, "")}</span>
          </li>
        ))}
      </ol>
      {sources.length > 0 && (
        <div className="generation-sources">
          <div className="generation-sources__heading">
            <span>검색 결과 교차 검토</span>
            <strong>{sources.length}개 출처</strong>
          </div>
          <div className="generation-sources__list">
            {sources.slice(0, 6).map((source) => (
              <a key={source.id} href={citationHref(source.sourceUrl)} target="_blank" rel="noopener noreferrer" className="generation-source-card">
                <span className="generation-source-card__domain">{sourceDomain(source.sourceUrl)}</span>
                <strong>{source.title}</strong>
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

type ActivityItem = {
  id: string;
  type: "chat" | "search" | "agent" | "approval" | "document";
  typeLabel: string;
  title: string;
  status: string;
  createdAt: string;
  target: "chat" | "search" | "tasks" | "approvals" | "documents" | "schedule";
  resourceId?: string;
  detail?: string;
};

type ActivityDashboard = {
  items: ActivityItem[];
  suggestedQuestions: Array<{
    id: string;
    category: "frequent" | "recent";
    label: string;
    question: string;
    meta: string;
  }>;
  notifications: Array<{
    id: string;
    level: "warning" | "error" | "info";
    title: string;
    description: string;
    target: "chat" | "search" | "tasks" | "approvals" | "documents" | "schedule";
  }>;
  summary: {
    todayActivities: number;
    pendingApprovals: number;
    enabledTools: number;
    failedRuns: number;
  };
};

const defaultChatSuggestions: ActivityDashboard["suggestedQuestions"] = [
  {
    id: "default-safety",
    category: "frequent",
    label: "최신 안전 수칙 핵심 내용",
    question: "최신 안전 수칙의 핵심 내용과 현장 적용 항목을 요약해줘.",
    meta: "자주 찾는 업무 주제",
  },
  {
    id: "default-maintenance",
    category: "frequent",
    label: "설비 정기 점검 기준",
    question: "설비 정기 점검 주기와 필수 확인 항목을 알려줘.",
    meta: "자주 찾는 업무 주제",
  },
  {
    id: "default-supply-chain",
    category: "recent",
    label: "최근 공급망 리스크",
    question: "최근 공급망 리스크 이슈와 우리 업무에 미치는 영향을 분석해줘.",
    meta: "최근 업무 이슈",
  },
  {
    id: "default-manufacturing-ai",
    category: "recent",
    label: "AI 활용 동향",
    question: `${COMPANY_NAME} 베어링 제조 업무에 적용할 수 있는 최근 AI 활용 동향과 실무 사례를 정리해줘.`,
    meta: "최근 업무 이슈",
  },
];

type GatewayResponse = {
  content?: string;
  choices?: Array<{ message?: { content?: string } }>;
  provider?: string;
  model?: string;
  finish_reason?: string;
  trace_id?: string;
  latency_ms?: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  conversation_id?: string;
  message_id?: string;
  grounded?: boolean;
  citations?: Array<{
    id: string;
    assetId: string;
    segmentId: string;
    title: string;
    version?: number;
    updatedAt?: string;
    publishedAt?: string;
    heading?: string;
    pageNumber?: number;
    excerpt: string;
    score: number;
    url?: string;
    sourceType?: "document" | "image" | "audio" | "video" | "web";
    source?: string;
    regionId?: string;
    regionType?: "image" | "page" | "table" | "chart";
    region?: [number, number, number, number];
    originalUrl?: string;
    timeStartMs?: number;
    timeEndMs?: number;
  }>;
  follow_up_questions?: FollowUpQuestion[];
  related_questions?: FollowUpQuestion[];
  clarification_required?: boolean;
  error?: { message?: string };
};

function gatewayCitationToResult(citation: NonNullable<GatewayResponse["citations"]>[number]): RagResultItem {
  return {
    id: citation.segmentId,
    title: citation.title,
    sourceType: citation.sourceType === "web" ? "web" : citation.sourceType === "image" ? "image" : citation.sourceType === "audio" ? "audio" : citation.sourceType === "video" ? "video" : "document",
    snippet: citation.excerpt,
    citation: citation.excerpt,
    score: citation.score,
    page: citation.pageNumber,
    section: citation.heading,
    chunkId: citation.segmentId,
    fileName: citation.title,
    sourceLabel: citation.source || citation.id,
    updatedAt: formatSearchDate(citation.updatedAt || citation.publishedAt),
    version: citation.sourceType === "web"
      ? (citation.publishedAt || citation.updatedAt ? "게시·갱신일 확인" : "날짜 미확인")
      : citation.version ? `v${citation.version}` : "버전 미확인",
    sourceUrl: citation.url || `/api/v1/citations?asset_id=${encodeURIComponent(citation.assetId)}&segment_id=${encodeURIComponent(citation.segmentId)}`,
    citationId: citation.id,
    regionId: citation.regionId,
    regionType: citation.regionType,
    region: citation.region,
    originalUrl: citation.originalUrl,
    timeStartMs: citation.timeStartMs,
    timeEndMs: citation.timeEndMs,
  };
}

type UseCase = {
  scope: Scope;
  title: string;
  audience: string;
  description: string;
  prompt: string;
  agent: string;
  sources: string[];
  output: string;
  risk: "R0" | "R1" | "R2" | "R3";
};

type NavigationItem = { id: View; label: string; mark: string; req: string; permission: string; feature?: string; icon: string };

const adminNavigationItem: NavigationItem = {
  id: "admin",
  label: "관리자 콘솔",
  mark: "AD",
  req: "A-01",
  permission: "admin.permissions",
  icon: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.7" fill="none"/>',
};

const navItems: NavigationItem[] = [
  { id: "home", label: "홈", mark: "HM", req: "U-01", permission: "workspace.home", feature: "workspace.home", icon: '<path d="M3 12L12 3l9 9v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1v-9z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>' },
  { id: "chat", label: "AI Chat Agent", mark: "AI", req: "U-02", permission: "ai.chat", feature: "ai.chat", icon: '<path d="M21 11.5a8.38 8.38 0 0 1-9 8.5 8.5 8.5 0 0 1-3.6-.8L3 21l1.9-4.4A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3a8.38 8.38 0 0 1 8.5 8.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/><circle cx="9" cy="11.5" r="1" fill="currentColor"/><circle cx="12.5" cy="11.5" r="1" fill="currentColor"/><circle cx="16" cy="11.5" r="1" fill="currentColor"/>' },
  { id: "search", label: "Knowledge Data Base", mark: "KDB", req: "U-03", permission: "rag.search", feature: "rag.search", icon: '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="m21 21-4.3-4.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' },
  { id: "tasks", label: "작업", mark: "TK", req: "U-05", permission: "agent.run", feature: "agent", icon: '<path d="M9 11l3 3L22 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: "approvals", label: "승인", mark: "AP", req: "U-06", permission: "tools.review", feature: "tool.approvals", icon: '<path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" fill="none"/>' },
  { id: "activity", label: "내 활동", mark: "MY", req: "U-07", permission: "activity.read", feature: "activity", icon: '<path d="M3 3v18h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M7 14l3-4 3 2 5-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: "schedule", label: "스케줄", mark: "SC", req: "U-08", permission: "ai.chat", feature: "ai.chat", icon: '<rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M3 9h18M8 2v4M16 2v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 14h2v2H8zM14 14h2v2h-2z" stroke="currentColor" stroke-width="1.5" fill="none"/>' },
  adminNavigationItem,
];

const useCases: UseCase[] = [
  {
    scope: "personal",
    title: "오늘의 업무 브리핑",
    audience: "전 임직원",
    description: "회의·메일·결재·담당 업무를 한 화면에서 우선순위로 요약합니다.",
    prompt: "오늘 일진글로벌 베어링 사업에서 내가 먼저 처리해야 할 업무를 중요도 순으로 정리해줘.",
    agent: "Work Briefing Agent",
    sources: ["그룹웨어", "일정", "ITSM"],
    output: "우선순위 브리핑",
    risk: "R1",
  },
  {
    scope: "personal",
    title: "휴가·복지 맞춤 안내",
    audience: "개인",
    description: "잔여 휴가와 적용 가능한 복지 제도를 개인 권한 안에서 안내합니다.",
    prompt: "내 잔여 휴가와 이번 달 신청 가능한 복지 제도를 알려줘.",
    agent: "HR Agent",
    sources: ["HR", "사규"],
    output: "개인 맞춤 안내",
    risk: "R1",
  },
  {
    scope: "personal",
    title: "출장 신청 초안",
    audience: "출장 예정자",
    description: "일정과 출장 규정을 확인해 결재 전 초안을 생성합니다.",
    prompt: "다음 주 베어링 생산 거점 출장 신청서를 규정에 맞게 작성해줘.",
    agent: "Business Support Agent",
    sources: ["일정", "출장 규정", "결재"],
    output: "결재 초안",
    risk: "R2",
  },
  {
    scope: "personal",
    title: "교육·자격 갭 분석",
    audience: "기술·생산 직군",
    description: "직무 필수 교육과 보유 자격을 비교해 다음 학습 계획을 추천합니다.",
    prompt: "내 직무 기준으로 올해 이수하지 않은 교육을 찾아줘.",
    agent: "Learning Agent",
    sources: ["LMS", "HR", "직무 체계"],
    output: "학습 계획",
    risk: "R1",
  },
  {
    scope: "personal",
    title: "내 문서 비교",
    audience: "기획·관리 직군",
    description: "여러 버전의 문서를 비교하고 변경 근거를 Citation과 함께 표시합니다.",
    prompt: "지난달과 이번 달 베어링 사업계획의 변경점을 근거와 함께 비교해줘.",
    agent: "Document Agent",
    sources: ["내 문서", "SharePoint"],
    output: "변경점 표",
    risk: "R1",
  },
  {
    scope: "personal",
    title: "개인 IT 지원",
    audience: "전 임직원",
    description: "사용자의 장비·계정 정보를 바탕으로 해결 절차와 티켓 초안을 제공합니다.",
    prompt: "VPN 접속 오류 원인을 확인하고 필요한 티켓을 작성해줘.",
    agent: "IT Support Agent",
    sources: ["ITSM", "FAQ", "장비 정보"],
    output: "해결 절차·티켓 초안",
    risk: "R2",
  },
  {
    scope: "personal",
    title: "회의 요약과 Action Item",
    audience: "회의 참석자",
    description: "녹취의 핵심 결론과 담당자·기한을 시간 근거와 함께 정리합니다.",
    prompt: "오늘 베어링 생산회의의 결정사항과 담당자별 할 일을 정리해줘.",
    agent: "Meeting Agent",
    sources: ["회의 녹취", "일정"],
    output: "회의록·Action Item",
    risk: "R1",
  },
  {
    scope: "personal",
    title: "메일·보고서 초안",
    audience: "전 임직원",
    description: "선택한 근거를 바탕으로 사내 형식에 맞는 초안을 생성합니다.",
    prompt: "베어링 품질 개선 결과를 임원 보고용 5줄 요약과 메일로 작성해줘.",
    agent: "Writing Agent",
    sources: ["선택 문서", "문서 템플릿"],
    output: "메일·보고서 초안",
    risk: "R2",
  },
  {
    scope: "department",
    title: "생산 설비 장애 대응",
    audience: "생산기술팀",
    description: "베어링 생산설비 사진과 오류 코드를 과거 장애 사례·매뉴얼과 교차 검색합니다.",
    prompt: "이 베어링 생산설비 사진의 이상 징후와 우선 점검 순서를 알려줘.",
    agent: "Maintenance Agent",
    sources: ["MES", "설비 매뉴얼", "장애 이력"],
    output: "점검 순서",
    risk: "R1",
  },
  {
    scope: "department",
    title: "품질 불량 원인 분석",
    audience: "품질보증팀",
    description: "베어링 불량 이미지·검사 결과·공정 조건을 함께 분석해 유사 사례를 찾습니다.",
    prompt: "이 베어링 표면 불량과 유사한 과거 사례와 공정 조건을 비교해줘.",
    agent: "Quality Agent",
    sources: ["QMS", "MES", "검사 이미지"],
    output: "원인 후보·근거",
    risk: "R1",
  },
  {
    scope: "department",
    title: "안전 위험성 평가 지원",
    audience: "안전환경팀",
    description: "베어링 조립·검사 작업 영상과 안전 규정을 연결해 위험 구간과 교육 근거를 제공합니다.",
    prompt: "이 베어링 조립 작업 영상에서 보호구 미착용 구간을 찾아 교육 기준을 연결해줘.",
    agent: "Safety Agent",
    sources: ["작업 영상", "안전 규정", "교육 자료"],
    output: "위험 구간·교육안",
    risk: "R1",
  },
  {
    scope: "department",
    title: "인사 반복 문의 분석",
    audience: "인사팀",
    description: "문의 주제를 분류하고 답변 공백과 규정 개선 후보를 제안합니다.",
    prompt: "이번 달 휴가·복지 문의를 유형별로 분류하고 개선점을 알려줘.",
    agent: "HR Insight Agent",
    sources: ["HR 문의", "사규", "FAQ"],
    output: "문의 분석 리포트",
    risk: "R1",
  },
  {
    scope: "department",
    title: "공급사 비교와 구매 검토",
    audience: "구매팀",
    description: "계약·납기·품질 데이터를 비교해 구매 검토표 초안을 만듭니다.",
    prompt: "베어링 원소재 A·B 공급사의 최근 1년 납기와 품질을 비교해줘.",
    agent: "Procurement Agent",
    sources: ["ERP", "계약", "품질 이력"],
    output: "공급사 비교표",
    risk: "R2",
  },
  {
    scope: "department",
    title: "영업 고객 브리핑",
    audience: "영업팀",
    description: "고객 활동·견적·이슈를 회의 전 한 장으로 요약합니다.",
    prompt: "내일 베어링 고객 미팅 전 최근 이슈와 제안 포인트를 브리핑해줘.",
    agent: "Sales Agent",
    sources: ["CRM", "메일", "견적"],
    output: "고객 브리핑",
    risk: "R1",
  },
  {
    scope: "department",
    title: "재무 실적 차이 분석",
    audience: "재무팀",
    description: "계획 대비 실적 차이를 계정·사업부별로 설명하고 근거를 연결합니다.",
    prompt: "2분기 베어링 사업 계획 대비 실적 차이가 큰 항목과 원인을 요약해줘.",
    agent: "Finance Agent",
    sources: ["ERP", "사업계획", "결산 자료"],
    output: "Variance 분석",
    risk: "R1",
  },
  {
    scope: "department",
    title: "설계 변경 영향 분석",
    audience: "R&D·설계팀",
    description: "도면·BOM·변경 이력을 연결해 영향 부품과 검토 항목을 제시합니다.",
    prompt: "이 베어링 도면 변경이 BOM과 기존 시험 항목에 미치는 영향을 찾아줘.",
    agent: "Engineering Agent",
    sources: ["PLM", "도면", "BOM", "시험 기준"],
    output: "영향 분석표",
    risk: "R1",
  },
  {
    scope: "department",
    title: "개발 이슈·PR 지원",
    audience: "IT개발팀",
    description: "Issue와 코드 변경을 연결해 테스트 체크리스트와 리뷰 초안을 생성합니다.",
    prompt: "이번 릴리스 PR의 영향 범위와 회귀 테스트를 정리해줘.",
    agent: "Development Agent",
    sources: ["Git", "Jira", "API 명세"],
    output: "리뷰·테스트 초안",
    risk: "R2",
  },
  {
    scope: "department",
    title: "IT 장애 대응 허브",
    audience: "IT운영팀",
    description: "서비스 상태·로그·유사 티켓을 조합해 조치안과 공지 초안을 만듭니다.",
    prompt: "현재 베어링 사업 ERP 지연과 유사한 장애를 찾고 사용자 공지를 작성해줘.",
    agent: "IT Ops Agent",
    sources: ["ITSM", "모니터링", "Runbook"],
    output: "조치안·공지 초안",
    risk: "R2",
  },
  {
    scope: "department",
    title: "경영 KPI 브리핑",
    audience: "경영기획팀",
    description: "부서별 KPI와 주요 이슈를 근거 중심의 경영 브리핑으로 압축합니다.",
    prompt: "이번 주 일진글로벌 베어링 사업 KPI 변화와 의사결정이 필요한 항목을 요약해줘.",
    agent: "Executive Briefing Agent",
    sources: ["ERP", "KPI", "주간보고"],
    output: "경영 브리핑",
    risk: "R1",
  },
  {
    scope: "department",
    title: "법무·계약 조항 비교",
    audience: "법무·구매팀",
    description: "계약 버전 간 책임·기간·해지 조건의 변경점을 근거와 함께 표시합니다.",
    prompt: "신규 계약서와 표준 계약서의 위험 조항 차이를 찾아줘.",
    agent: "Contract Agent",
    sources: ["계약 관리", "표준 조항"],
    output: "조항 비교표",
    risk: "R2",
  },
  {
    scope: "department",
    title: "에너지 사용 최적화",
    audience: "ESG·설비팀",
    description: "설비별 에너지 추이와 가동 조건을 비교해 절감 후보를 제시합니다.",
    prompt: "전월 대비 베어링 생산설비 에너지 사용이 증가한 설비와 원인 후보를 찾아줘.",
    agent: "ESG Agent",
    sources: ["EMS", "MES", "설비 이력"],
    output: "절감 후보 리포트",
    risk: "R1",
  },
];

function RequirementBadge({ children }: { children: string }) {
  return <span className="req-badge">{children}</span>;
}

function AccessGate({ access, onAuthenticated, onSignedOut, onRetry }: {
  access: Exclude<AccessState, { state: "approved" }>;
  onAuthenticated: (user: AccessUser) => void;
  onSignedOut: () => void;
  onRetry: () => void;
}) {
  const unrequested = access.state === "unrequested";
  const pending = access.state === "pending";
  const rejected = access.state === "rejected";
  const user = unrequested || pending || rejected ? access.user : undefined;
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [department, setDepartment] = useState(user?.department === "미지정" ? "" : user?.department || "");
  const [adminCode, setAdminCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const showApplication = unrequested || rejected;
  // 초기 관리자 코드를 입력한 경우는 서버가 ADMIN_EMAILS 대조로 판정한다.
  // 여기서 도메인만 보고 미리 막으면 최초 관리자가 가입 자체를 못 한다.
  const registrationEmailAllowed = /^[^\s@]+@iljin\.com$/i.test(email.trim()) || Boolean(adminCode.trim());

  const submitAuthentication = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password || submitting) return;
    const registering = authMode === "register";
    if (registering && !registrationEmailAllowed) {
      setFormError("일진 임직원 이메일(@iljin.com)만 가입할 수 있습니다.");
      return;
    }
    setSubmitting(true);
    setFormError("");
    setFormNotice("");
    try {
      const response = await fetch(registering ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registering
          ? {
              email: email.trim(),
              password,
              displayName: displayName.trim(),
              department: department.trim(),
              adminCode: adminCode.trim() || undefined,
            }
          : { email: email.trim(), password }),
      });
      const payload = await response.json() as { user?: AccessUser; verificationRequired?: boolean; error?: { message?: string } };
      if (registering && response.ok && payload.verificationRequired) {
        setPassword("");
        setAdminCode("");
        setFormNotice("인증 메일을 보냈습니다. 받은 편지함에서 링크를 열어 이메일 인증을 완료해 주세요.");
        return;
      }
      if (!response.ok || !payload.user) {
        throw new Error(payload.error?.message || (registering ? "가입 신청을 처리하지 못했습니다." : "로그인하지 못했습니다."));
      }
      onAuthenticated(payload.user);
      setPassword("");
      setAdminCode("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "인증 요청을 처리하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitApplication = async (event: FormEvent) => {
    event.preventDefault();
    if (!department.trim() || submitting) return;
    setSubmitting(true);
    setFormError("");
    try {
      const response = await fetch("/api/auth/application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department: department.trim() }),
      });
      const payload = await response.json() as { user?: AccessUser; error?: { message?: string } };
      if (!response.ok || !payload.user) throw new Error(payload.error?.message || "가입 신청을 처리하지 못했습니다.");
      onAuthenticated(payload.user);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "가입 신청을 처리하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const signOut = async () => {
    setSubmitting(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: { Accept: "application/json" } });
    } finally {
      setSubmitting(false);
      onSignedOut();
    }
  };

  return (
    <main className="access-gate">
      <section className="access-gate-card" aria-live="polite">
        <Image src="/iljin-logo.png" alt="ILJIN" width={112} height={26} priority unoptimized />
        <span className={`access-state access-state-${access.state}`}>
          {access.state === "checking" ? "로그인 확인 중" : access.state === "signed_out" ? "로그인 필요" : unrequested ? "가입 신청 필요" : pending ? "가입 승인 대기" : rejected ? "가입 신청 반려" : "연결 오류"}
        </span>
        <h1 className={access.state === "signed_out" ? "access-gate-login-title" : undefined}>{unrequested ? "이메일 가입 신청서를 작성해 주세요" : pending ? "가입 신청이 접수되었습니다" : rejected ? "가입 신청을 다시 제출할 수 있습니다" : access.state === "checking" ? "로그인 상태를 확인하고 있습니다" : access.state === "signed_out" ? "ILJIN AI Works에 로그인해 주세요" : "사용자 상태를 확인하지 못했습니다"}</h1>
        <p>{unrequested ? "희망 부서를 제출하면 관리자가 검토합니다." : pending ? "관리자가 조직과 역할을 확인한 뒤 가입을 승인하면 모든 업무 기능을 사용할 수 있습니다." : rejected ? user?.rejectionReason || "신청 정보를 보완해 다시 제출해 주세요." : access.state === "checking" ? "잠시만 기다려 주세요." : access.state === "signed_out" ? "@iljin.com 회사 이메일로 가입을 신청할 수 있습니다." : "message" in access ? access.message : "사용자 상태를 확인하지 못했습니다."}</p>
        <ol className="signup-steps" aria-label="가입 진행 단계">
          <li className={access.state === "signed_out" || access.state === "checking" ? "active" : "complete"}><span>1</span><div><strong>계정 등록</strong><small>이메일·비밀번호</small></div></li>
          <li className={unrequested ? "active" : pending || rejected ? "complete" : ""}><span>2</span><div><strong>가입 신청</strong><small>이름·부서</small></div></li>
        <li className={pending ? "active" : rejected ? "rejected" : ""}><span>3</span><div><strong>가입 승인</strong><small>조직·역할 배정</small></div></li>
        </ol>
        {access.state === "signed_out" && <>
          <div className="auth-mode-switch" role="group" aria-label="로그인 방식">
            <button type="button" className={authMode === "login" ? "selected" : ""} aria-pressed={authMode === "login"} onClick={() => { setAuthMode("login"); setFormError(""); }}>로그인</button>
            <button type="button" className={authMode === "register" ? "selected" : ""} aria-pressed={authMode === "register"} onClick={() => { setAuthMode("register"); setFormError(""); }}>가입 신청</button>
          </div>
          <form className="access-application-form auth-form" onSubmit={submitAuthentication}>
            {authMode === "register" && <label><span>이름</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" maxLength={120} required placeholder="예: 김지원" /></label>}
            <label><span>이메일</span><input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setFormError(""); }} autoComplete="email" maxLength={254} required placeholder="name@iljin.com" />{authMode === "register" && <small className="field-hint">일진 임직원 이메일(@iljin.com)만 가입할 수 있습니다.</small>}</label>
            <label><span>비밀번호</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={authMode === "login" ? "current-password" : "new-password"} minLength={12} maxLength={128} required placeholder="12자 이상 입력" /></label>
            {authMode === "register" && <>
              <label><span>희망 부서</span><input value={department} onChange={(event) => setDepartment(event.target.value)} maxLength={120} required placeholder={`예: ${DEFAULT_DEPARTMENT}`} /></label>
              <details className="admin-bootstrap"><summary>초기 관리자 계정 설정</summary><label><span>관리자 초기 설정 코드</span><input type="password" value={adminCode} onChange={(event) => setAdminCode(event.target.value)} autoComplete="one-time-code" maxLength={256} placeholder="관리자 이메일인 경우에만 입력" /></label></details>
            </>}
            {formError && <p className="form-error" role="alert">{formError}</p>}
            {formNotice && <p className="field-hint" role="status">{formNotice}</p>}
            <button className="button button-primary" type="submit" disabled={submitting || !email.trim() || !password || (authMode === "register" && (!displayName.trim() || !department.trim()))}>{submitting ? "처리 중" : authMode === "register" ? "이메일 가입 신청" : "로그인"}</button>
          </form>
        </>}
        {user && <dl><div><dt>이메일</dt><dd>{user.email}</dd></div><div><dt>신청자</dt><dd>{user.displayName}</dd></div>{pending && <div><dt>신청 부서</dt><dd>{user.department}</dd></div>}</dl>}
        {showApplication && <form className="access-application-form" onSubmit={submitApplication}>
          <label><span>희망 부서</span><input value={department} onChange={(event) => setDepartment(event.target.value)} maxLength={120} required placeholder={`예: ${DEFAULT_DEPARTMENT}`} /></label>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <button className="button button-primary" type="submit" disabled={submitting || !department.trim()}>{submitting ? "신청 중" : rejected ? "가입 재신청" : "이메일 가입 신청"}</button>
        </form>}
        <div className="access-gate-actions">
              {(pending || access.state === "error") && <button className="button button-primary" type="button" onClick={onRetry}>{access.state === "error" ? "연결 다시 확인" : "가입 승인 상태 확인"}</button>}
          {(unrequested || pending || rejected) && <button className="button button-secondary" type="button" disabled={submitting} onClick={signOut}>로그아웃</button>}
        </div>
        {access.state === "error" && access.traceId && <small className="access-trace">문의 시 추적 번호: {access.traceId}</small>}
      </section>
    </main>
  );
}

export function AgentPortal() {
  const [view, setView] = useState<View>("home");
  const [scope, setScope] = useState<Scope>("personal");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [chatSensitivity, setChatSensitivity] = useState<ChatSensitivity>("public");
  const [chatSearchScope, setChatSearchScope] = useState<SearchScope>("internet");
  const [chatAnswerLength, setChatAnswerLength] = useState<ChatAnswerLength>("standard");
  const [streaming, setStreaming] = useState(false);
  const [generationElapsedMs, setGenerationElapsedMs] = useState(0);
  const [generationStage, setGenerationStage] = useState("질문·의도 분석 중");
  const [providerAvailability, setProviderAvailability] = useState({
    cloudflare: false,
    local: false,
    rag: false,
    internalSearch: false,
  });
  const [searchType, setSearchType] = useState("전체");
  const [notice, setNotice] = useState("");
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiStatus>({
    state: "checking",
    label: "API 확인 중",
    detail: "Health API 응답을 기다리고 있습니다.",
  });
  const [access, setAccess] = useState<AccessState>({ state: "checking" });
  const [accessCheckVersion, setAccessCheckVersion] = useState(0);
  const [activityDashboard, setActivityDashboard] = useState<ActivityDashboard>({
    items: [],
    suggestedQuestions: defaultChatSuggestions,
    notifications: [],
    summary: { todayActivities: 0, pendingApprovals: 0, enabledTools: 0, failedRuns: 0 },
  });
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ displayName: "", department: "" });
  const [passwordDraft, setPasswordDraft] = useState({ current: "", next: "", confirmation: "" });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [themeColor, setThemeColor] = useState<ThemeColor>("blue");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [resolvedThemeMode, setResolvedThemeMode] = useState<"light" | "dark">("light");
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatStreamCancelRef = useRef<(() => void) | null>(null);
  const authenticatedEmail = access.state === "approved" ? access.user.email : "";

  useEffect(() => {
    if (!authenticatedEmail) return;
    const storedTheme = window.localStorage.getItem(`iljin-ai-theme:${authenticatedEmail}`);
    if (!isThemeColor(storedTheme)) return;
    const timer = setTimeout(() => setThemeColor(storedTheme), 0);
    return () => clearTimeout(timer);
  }, [authenticatedEmail]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setResolvedThemeMode(themeMode === "system" ? (media.matches ? "dark" : "light") : themeMode);
    sync();
    if (themeMode !== "system") return;
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [themeMode]);

  useEffect(() => {
    if (!authenticatedEmail) return;
    const storedMode = window.localStorage.getItem(`iljin-ai-theme-mode:${authenticatedEmail}`);
    if (storedMode !== "light" && storedMode !== "dark" && storedMode !== "system") return;
    const timer = setTimeout(() => setThemeMode(storedMode), 0);
    return () => clearTimeout(timer);
  }, [authenticatedEmail]);

  useEffect(() => {
    const storedSidebar = authenticatedEmail ? window.localStorage.getItem(`iljin-ai-sidebar:${authenticatedEmail}`) : null;
    const timer = setTimeout(() => setSidebarCollapsed(storedSidebar === "collapsed"), 0);
    return () => clearTimeout(timer);
  }, [authenticatedEmail]);

  useEffect(() => {
    const updateClock = () => setCurrentTime(new Date());
    updateClock();
    const timer = window.setInterval(updateClock, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        const health = await response.json() as {
          status?: string;
          gateway?: { configured?: boolean; model?: string };
          llmRouting?: {
            primaryConfigured?: boolean;
            secondaryConfigured?: boolean;
            fallbackConfigured?: boolean;
          };
          rag?: {
            embeddingConfigured?: boolean;
            rerankConfigured?: boolean;
          };
          checked_at?: string;
        };
        if (!response.ok && !health.gateway) throw new Error("health check failed");
        return health;
      })
      .then((health) => {
        const configured = health.gateway?.configured === true;
        const cloudflare = health.llmRouting?.primaryConfigured === true;
        const local = health.llmRouting?.fallbackConfigured === true;
        const rag = health.rag?.embeddingConfigured === true && health.rag?.rerankConfigured === true;
        setProviderAvailability({
          cloudflare,
          local,
          rag,
          internalSearch: rag && (local || cloudflare),
        });
        setApiStatus({
          state: configured ? "ready" : "configuration",
          label: configured ? "API 준비" : "API 설정 필요",
          detail: configured
            ? `${health.gateway?.model || "LLM Gateway"} 설정 확인 완료`
            : "LLM Gateway 환경 설정이 필요합니다.",
        });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setApiStatus({
            state: "offline",
            label: "API 확인 실패",
            detail: "Health API에 연결하지 못했습니다.",
          });
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/me", { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (response) => {
        const payload = await response.json() as { user?: AccessUser; error?: { message?: string; code?: string; trace_id?: string; retryable?: boolean } };
        if (response.status === 401) {
          setAccess({ state: "signed_out" });
          return;
        }
        if (!response.ok || !payload.user) {
          const configurationError = payload.error?.code === "RUNTIME_CONFIGURATION_REQUIRED";
          setAccess({
            state: "error",
            message: configurationError
              ? "인증 서비스 연결을 준비 중입니다. 잠시 후 다시 확인해 주세요."
              : payload.error?.message || "로그인 사용자 정보를 확인하지 못했습니다.",
            traceId: payload.error?.trace_id || response.headers.get("X-Trace-Id") || undefined,
            retryAfter: configurationError ? 30 : undefined,
          });
          return;
        }
        setAccess({ state: payload.user.status, user: payload.user });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setAccess({ state: "error", message: error instanceof Error ? error.message : "로그인 연결에 실패했습니다." });
        }
      });
    return () => controller.abort();
  }, [accessCheckVersion]);

  useEffect(() => {
    if (!("user" in access)) return;
    const refreshRestoredPage = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", refreshRestoredPage);
    return () => {
      window.removeEventListener("pageshow", refreshRestoredPage);
    };
  }, [access]);

  useEffect(() => {
    if (access.state !== "approved") return;
    const controller = new AbortController();
    fetch("/api/v1/activity?limit=8", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as ActivityDashboard & { error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message || "활동 요약을 불러오지 못했습니다.");
        return payload;
      })
      .then(setActivityDashboard)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setNotice(error instanceof Error ? error.message : "활동 요약을 불러오지 못했습니다.");
        }
      });
    return () => controller.abort();
  }, [access.state]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const menuButton = menuButtonRef.current;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
        return;
      }
      if (event.key !== "Tab" || !navigationRef.current) return;
      const focusable = Array.from(
        navigationRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.classList.add("nav-open");
    document.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(() => {
      navigationRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
    });
    return () => {
      document.body.classList.remove("nav-open");
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus === menuButton) menuButton?.focus();
    };
  }, [mobileNavOpen]);

  const visibleUseCases = useMemo(() => useCases.filter((item) => item.scope === scope), [scope]);
  const currentLabel = navItems.find((item) => item.id === view)?.label ?? "홈";

  const displayedLabel = view === "feedback" ? "사용자 의견" : currentLabel;

  const navigate = (next: View) => {
    setView(next);
    setMobileNavOpen(false);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    requestAnimationFrame(() => document.getElementById("main-content")?.focus({ preventScroll: true }));
  };

  useEffect(() => {
    if (!streaming) return;
    const startedAt = Date.now();
    const updateElapsed = () => setGenerationElapsedMs(Date.now() - startedAt);
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(timer);
  }, [streaming]);

  const submitChat = async (event: FormEvent, agent?: ChatAgent) => {
    event.preventDefault();
    const rawText = query.trim();
    const command = agent ? `/${agent.name}` : "";
    const text = agent && rawText.startsWith(command) ? rawText.slice(command.length).trim() : rawText;
    if (!text || streaming) return;
    await runChat(text, agent ? `${command} ${text}` : text, agent?.id);
  };

  const submitChatWithText = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setQuery(trimmed);
    await runChat(trimmed);
  };

  const submitClarification = async (
    originalQuestion: string,
    questions: FollowUpQuestion[],
    answers: string[],
  ) => {
    const answerLines = questions.map((item, index) =>
      `${index + 1}. ${item.question}\n답변: ${answers[index].trim()}`
    ).join("\n\n");
    const requestBody = `최초 질문:\n${originalQuestion}\n\n사용자가 제공한 보충 정보:\n${answerLines}\n\n위 보충 정보를 검색 조건과 답변 맥락에 반영해 최초 질문에 대한 최종 답변을 생성하세요. 추가 정보가 꼭 필요하지 않다면 보충 질문을 반복하지 마세요.`;
    const displayBody = `보충 정보를 제출했습니다.\n\n${questions.map((item, index) => `- ${item.question}\n  ${answers[index].trim()}`).join("\n")}`;
    await runChat(requestBody, displayBody);
  };

  const runChat = async (text: string, displayText = text, agentId?: string) => {
    const effectiveSensitivity: ChatSensitivity = chatSearchScope === "internet"
      ? "public"
      : chatSensitivity === "public"
        ? "internal"
        : chatSensitivity;
    if (chatSearchScope === "internal" && !providerAvailability.internalSearch) {
      setNotice("내부 검색에는 Cloudflare RAG와 사용 가능한 LLM 연결이 필요합니다.");
      return;
    }
    const nextMessages: ChatMessage[] = [...chatMessages, {
      role: "user",
      body: displayText,
      requestBody: displayText === text ? undefined : text,
    }];
    setChatMessages(nextMessages);
    setQuery("");
    setGenerationElapsedMs(0);
    setGenerationStage(GENERATION_STAGES[chatSearchScope][0]);
    setStreaming(true);
    setNotice("LLM Gateway가 보안 정책에 맞는 Provider를 선택하고 있습니다.");
    const controller = new AbortController();
    chatAbortRef.current = controller;
    let cancelTypewriter: (() => void) | undefined;

    try {
      let activeConversationId = conversationId;
      if (!activeConversationId) {
        const createResponse = await fetch("/api/v1/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: text.slice(0, 120) }),
          signal: controller.signal,
        });
        const createPayload = await createResponse.json() as { conversation_id?: string; error?: { message?: string } };
        if (!createResponse.ok || !createPayload.conversation_id) {
          throw new Error(createPayload.error?.message || "대화를 저장할 공간을 만들지 못했습니다.");
        }
        activeConversationId = createPayload.conversation_id;
        setConversationId(activeConversationId);
      }
      const requestMessages = nextMessages
        .filter((message) => !message.error)
        .map((message) => ({ role: message.role, content: message.requestBody || message.body }));
      // The final streaming response already exposes its first line as the
      // quick summary. A separate preview request duplicated retrieval
      // and generation, so every answer waited for two model calls in series.
      const response = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sensitivity": effectiveSensitivity,
        },
        body: JSON.stringify({
          messages: requestMessages,
          sensitivity: effectiveSensitivity,
          rag: chatSearchScope === "internal",
          search_mode: chatSearchScope,
          answer_length: chatAnswerLength,
          reasoning_tier: chatAnswerLength === "brief" ? "swift" : chatAnswerLength === "detailed" ? "deep" : "expert",
          stream: true,
          conversation_id: activeConversationId,
          agent_id: agentId,
        }),
        signal: controller.signal,
      });
      const responseType = response.headers.get("Content-Type") || "";
      if (responseType.includes("text/event-stream")) {
        if (!response.ok || !response.body) throw new Error("Streaming 응답을 시작하지 못했습니다.");
        const provider = response.headers.get("X-LLM-Provider") || undefined;
        const reader = response.body.getReader();
        chatStreamCancelRef.current = () => { void reader.cancel(); };
        const decoder = new TextDecoder();
        let buffer = "";
        let streamedContent = "";
        let streamedSummary = "";
        const streamedCitations: NonNullable<GatewayResponse["citations"]> = [];
        let done: {
          message_id?: string;
          conversation_id?: string;
          trace_id?: string;
          provider?: string;
          model?: string;
          finish_reason?: string;
          latency_ms?: number;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
          follow_up_questions?: FollowUpQuestion[];
          related_questions?: FollowUpQuestion[];
          clarification_required?: boolean;
        } = {};
          setChatMessages((messages) => messages.some((message) => message.streamingResponse)
            ? messages
            : [...messages, {
                role: "assistant",
                body: "",
                provider,
                streamingResponse: true,
                streamingStage: generationStage,
              }]);

        let displayedContent = "";
        let typewriterQueue = "";
        let typewriterTimer: ReturnType<typeof setInterval> | undefined;
        let resolveTypewriter: (() => void) | undefined;
        let typewriterDone = Promise.resolve();
        const updateDisplayedContent = () => {
          const deliveredCharacters = displayedContent.trim().length;
          setChatMessages((messages) => messages.map((message, index) =>
            index === messages.length - 1 && message.streamingResponse
              ? {
                  ...message,
                  body: displayedContent,
                  streamingDetail: deliveredCharacters
                    ? `답변 본문 ${deliveredCharacters.toLocaleString()}자를 전송했습니다.`
                    : undefined,
                }
              : message
          ));
        };
        const startTypewriter = () => {
          if (typewriterTimer) return;
          typewriterDone = new Promise<void>((resolve) => { resolveTypewriter = resolve; });
          typewriterTimer = setInterval(() => {
            if (!typewriterQueue) {
              clearInterval(typewriterTimer);
              typewriterTimer = undefined;
              resolveTypewriter?.();
              resolveTypewriter = undefined;
              return;
            }
            displayedContent += typewriterQueue.slice(0, 2);
            typewriterQueue = typewriterQueue.slice(2);
            updateDisplayedContent();
          }, 18);
        };
        cancelTypewriter = () => {
          if (typewriterTimer) clearInterval(typewriterTimer);
          typewriterTimer = undefined;
          typewriterQueue = "";
          resolveTypewriter?.();
          resolveTypewriter = undefined;
        };

        const applyEvent = (eventBlock: string) => {
          const lines = eventBlock.split(/\r?\n/);
          const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
          const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
          if (!eventName || !data) return;
          const eventPayload = JSON.parse(data) as Record<string, unknown>;
          if (eventName === "stage" && typeof eventPayload.stage === "string") {
            setGenerationStage(eventPayload.stage);
            const sourceCount = typeof eventPayload.sourceCount === "number" ? eventPayload.sourceCount : undefined;
            setChatMessages((messages) => messages.map((message, index) =>
              index === messages.length - 1 && message.streamingResponse
                ? {
                    ...message,
                    streamingStage: eventPayload.stage as string,
                    // A stage transition must replace the previous status. Keeping an old
                    // search count here made it look as if search was still running while
                    // the answer itself was being generated.
                    streamingDetail: sourceCount === undefined ? undefined : `${sourceCount}개 검색 결과를 교차 검토하고 있습니다.`,
                    tokenCount: typeof eventPayload.tokens === "number" ? eventPayload.tokens as number : message.tokenCount,
                  }
                : message
            ));
          } else if (eventName === "delta" && typeof eventPayload.text === "string") {
            streamedContent += eventPayload.text;
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
              displayedContent = streamedContent;
              updateDisplayedContent();
            } else {
              typewriterQueue += eventPayload.text;
              startTypewriter();
            }
          } else if (eventName === "summary" && typeof eventPayload.text === "string") {
            streamedSummary = eventPayload.text;
            setChatMessages((messages) => messages.map((message, index) =>
              index === messages.length - 1 && message.streamingResponse
                ? { ...message, streamingSummary: streamedSummary }
                : message
            ));
          } else if (eventName === "citation") {
            streamedCitations.push(eventPayload as NonNullable<GatewayResponse["citations"]>[number]);
            const liveCitation = gatewayCitationToResult(eventPayload as NonNullable<GatewayResponse["citations"]>[number]);
            setChatMessages((messages) => messages.map((message, index) => {
              if (index !== messages.length - 1 || !message.streamingResponse) return message;
                const citations = [...(message.citations || []).filter((citation) => citation.id !== liveCitation.id), liveCitation];
              return {
                ...message,
                citations,
                streamingDetail: `${citations.length}개 근거를 답변에 연결했습니다.`,
              };
            }));
          } else if (eventName === "error" && typeof eventPayload.message === "string") {
            throw new Error(eventPayload.message as string);
          } else if (eventName === "done") {
            done = eventPayload as typeof done;
          }
        };

        while (true) {
          const { done: readerDone, value } = await reader.read();
          if (controller.signal.aborted) throw new DOMException("답변 생성이 중단되었습니다.", "AbortError");
          buffer += decoder.decode(value || new Uint8Array(), { stream: !readerDone });
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() || "";
          blocks.forEach(applyEvent);
          if (readerDone) break;
        }
        if (buffer.trim()) applyEvent(buffer);
        await typewriterDone;
        if (!streamedContent.trim() && !streamedSummary.trim()) throw new Error("LLM Gateway가 빈 Streaming 응답을 반환했습니다.");
        if (done.conversation_id) setConversationId(done.conversation_id);
        setChatMessages((messages) => messages.map((message, index) =>
          index === messages.length - 1 && message.streamingResponse
            ? {
                ...message,
                body: [streamedSummary, displayedContent.trim()].filter(Boolean).join("\n\n"),
                streamingResponse: false,
                streamingStage: undefined,
                streamingDetail: undefined,
                streamingSummary: undefined,
                tokenCount: (done.usage as Record<string, number> | undefined)?.total_tokens || message.tokenCount,
                messageId: done.message_id,
                provider: done.provider || provider,
                model: done.model,
                traceId: done.trace_id || response.headers.get("X-Trace-Id") || undefined,
                latencyMs: done.latency_ms,
                citations: streamedCitations.map(gatewayCitationToResult),
                followUpQuestions: done.follow_up_questions,
                relatedQuestions: done.related_questions,
                clarificationRequired: done.clarification_required,
                clarificationOriginalQuestion: done.clarification_required ? text : undefined,
              }
            : message
        ));
        cancelTypewriter = undefined;
        if (done.clarification_required) {
          setNotice("최종 답변 생성 전입니다. 정확한 답변을 위해 보충 정보를 입력해 주세요.");
        } else {
          const providerLabel = (done.provider || provider) === "cloudflare" ? "Cloud LLM" : "로컬 LLM";
          setNotice(done.finish_reason === "length"
            ? `${providerLabel} 답변이 출력 한도에 도달해 일부 내용이 생략되었습니다.`
            : `${providerLabel} Streaming 답변을 완료했습니다. ${done.latency_ms ?? 0}밀리초가 걸렸습니다.`);
        }
        return;
      }
      const rawPayload = await response.text();
      let payload: GatewayResponse;
      try {
        payload = JSON.parse(rawPayload) as GatewayResponse;
      } catch {
        const responseLabel = responseType.includes("text/html") ? "HTML 오류 페이지" : "예상하지 않은 응답";
        throw new Error(`${responseLabel}가 반환되었습니다. 잠시 후 다시 시도해 주세요.`);
      }
      const content = payload.choices?.[0]?.message?.content?.trim();

      if (!response.ok || !content) {
        throw new Error(payload.error?.message || "LLM Gateway 응답을 받지 못했습니다.");
      }
      if (payload.conversation_id) setConversationId(payload.conversation_id);

      setChatMessages((messages) => [
        ...messages,
        {
          role: "assistant",
          body: content,
          messageId: payload.message_id,
          provider: payload.provider,
          model: payload.model,
          traceId: payload.trace_id,
          latencyMs: payload.latency_ms,
          tokenCount: payload.usage?.total_tokens,
          citations: (payload.citations || []).map(gatewayCitationToResult),
          followUpQuestions: payload.follow_up_questions,
          relatedQuestions: payload.related_questions,
          clarificationRequired: payload.clarification_required,
          clarificationOriginalQuestion: payload.clarification_required ? text : undefined,
        },
      ]);
      if (payload.clarification_required) {
        setNotice("최종 답변 생성 전입니다. 정확한 답변을 위해 보충 정보를 입력해 주세요.");
      } else {
        const providerLabel = payload.provider === "cloudflare" ? "Cloud LLM" : "로컬 LLM";
        setNotice(payload.finish_reason === "length"
          ? `${providerLabel} 답변이 출력 한도에 도달해 일부 내용이 생략되었습니다.`
          : `${providerLabel} 답변을 준비했습니다. ${payload.latency_ms ?? 0}밀리초가 걸렸습니다.`);
      }
    } catch (error) {
      cancelTypewriter?.();
      if (error instanceof DOMException && error.name === "AbortError") {
        if (chatAbortRef.current !== controller) return;
        setChatMessages((messages) => {
          const withoutStream = messages.filter((message) => !message.streamingResponse);
          return withoutStream.at(-1)?.role === "user" ? withoutStream.slice(0, -1) : withoutStream;
        });
        setNotice("AI 답변 생성을 중단했습니다. 같은 질문을 다시 전송할 수 있습니다.");
        setQuery(displayText);
        return;
      }
      const errorMsg = error instanceof Error ? error.message : "LLM Gateway 연결 중 오류가 발생했습니다.";
      const isAuthError = errorMsg.includes("401") || errorMsg.includes("인증") || errorMsg.includes("로그인");
      const isTimeoutError = errorMsg.includes("504") || errorMsg.includes("초과") || errorMsg.includes("timeout");
      setChatMessages((messages) => [
        ...messages.filter((message) => !message.streamingResponse),
        {
          role: "assistant",
          body: isAuthError
            ? "세션이 만료되었습니다. 페이지를 새로고침하여 다시 로그인해 주세요."
            : isTimeoutError
              ? "AI 모델 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."
              : errorMsg,
          error: true,
        },
      ]);
      setNotice("LLM Gateway 연결을 확인해 주세요.");
    } finally {
      if (chatAbortRef.current === controller) {
        chatAbortRef.current = null;
        chatStreamCancelRef.current = null;
        setStreaming(false);
      }
    }
  };

  const stopChat = () => {
    const controller = chatAbortRef.current;
    if (!controller || controller.signal.aborted) return;
    chatAbortRef.current = null;
    chatStreamCancelRef.current?.();
    chatStreamCancelRef.current = null;
    controller.abort();
    setChatMessages((messages) => messages.map((message) => message.streamingResponse
      ? {
          ...message,
          body: message.body || message.streamingSummary || "답변 생성을 중단했습니다.",
          streamingResponse: false,
          streamingStage: undefined,
          streamingSummary: undefined,
        }
      : message));
    setStreaming(false);
    setNotice("AI 답변 생성을 중단했습니다.");
  };

  const cleanupTemporaryAttachments = async (id?: string) => {
    if (!id) return;
    await fetch(`/api/v1/conversations/${encodeURIComponent(id)}/attachments`, {
      method: "DELETE",
    }).catch(() => undefined);
  };

  const resetConversationState = () => {
    setConversationId(undefined);
    setChatMessages([]);
    setQuery("");
  };

  const ensureConversationForAttachment = async () => {
    let activeConversationId = conversationId;
    if (chatSearchScope !== "internal") {
      await cleanupTemporaryAttachments(activeConversationId);
      resetConversationState();
      setChatSearchScope("internal");
      setChatSensitivity("internal");
      activeConversationId = undefined;
    }
    if (activeConversationId) return activeConversationId;
    const response = await fetch("/api/v1/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "임시 첨부파일 분석" }),
    });
    const payload = await response.json() as {
      conversation_id?: string;
      error?: { message?: string };
    };
    if (!response.ok || !payload.conversation_id) {
      throw new Error(payload.error?.message || "첨부파일용 대화를 만들지 못했습니다.");
    }
    setConversationId(payload.conversation_id);
    return payload.conversation_id;
  };

  const changeChatSensitivity = (next: ChatSensitivity) => {
    if (next === chatSensitivity) return;
    setChatSensitivity(next);
    setChatSearchScope(next === "public" ? "internet" : "internal");
    if (chatMessages.length || conversationId) {
      void cleanupTemporaryAttachments(conversationId);
      resetConversationState();
      setNotice("데이터 등급이 변경되어 새 대화를 시작했습니다.");
    }
  };

  const changeChatSearchScope = (next: SearchScope) => {
    if (next === chatSearchScope) return;
    setChatSearchScope(next);
    setChatSensitivity(next === "internet" ? "public" : "internal");
    if (chatMessages.length || conversationId) {
      void cleanupTemporaryAttachments(conversationId);
      resetConversationState();
      setNotice(`${next === "internal" ? "내부" : "인터넷"} 검색으로 전환해 새 대화를 시작했습니다.`);
    }
  };

  const startNewConversation = async () => {
    await cleanupTemporaryAttachments(conversationId);
    resetConversationState();
    setNotice("새 대화를 시작했습니다.");
  };

  const openConversation = async (id: string) => {
    try {
      const response = await fetch(`/api/v1/conversations/${encodeURIComponent(id)}`, { cache: "no-store" });
      const payload = await response.json() as {
        id?: string;
        sensitivity?: ChatSensitivity;
        messages?: Array<{
          id: string;
          role: "user" | "assistant";
          content: string;
          provider?: string;
          model?: string;
          feedback?: number;
          citations?: GatewayResponse["citations"];
        }>;
        error?: { message?: string };
      };
      if (!response.ok || !payload.id) throw new Error(payload.error?.message || "대화를 불러오지 못했습니다.");
      setConversationId(payload.id);
      setChatSensitivity(payload.sensitivity || "internal");
      setChatSearchScope(payload.sensitivity === "public" ? "internet" : "internal");
      setChatMessages((payload.messages || []).map((message) => ({
        role: message.role,
        body: message.content,
        messageId: message.role === "assistant" ? message.id : undefined,
        provider: message.provider,
        model: message.model,
        feedback: message.feedback === 1 || message.feedback === -1 ? message.feedback : undefined,
        citations: (message.citations || []).map(gatewayCitationToResult),
      })));
      setView("chat");
      setNotificationOpen(false);
      setNotice("저장된 대화를 불러왔습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "대화를 불러오지 못했습니다.");
    }
  };

  const submitFeedback = async (messageId: string, rating: 1 | -1) => {
    try {
      const response = await fetch(`/api/v1/messages/${encodeURIComponent(messageId)}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating }),
      });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "평가를 저장하지 못했습니다.");
      setChatMessages((messages) => messages.map((message) => message.messageId === messageId ? { ...message, feedback: rating } : message));
      setNotice(rating === 1 ? "도움됨으로 평가했습니다." : "개선 필요로 평가했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "평가를 저장하지 못했습니다.");
    }
  };

  const handleComposerKey = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const signOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: { Accept: "application/json" } });
    } finally {
      setAccess({ state: "signed_out" });
      setView("home");
    }
  };

  const openProfile = () => {
    setProfileDraft({ displayName: currentUser.displayName, department: currentUser.department });
    setPasswordDraft({ current: "", next: "", confirmation: "" });
    setProfileError("");
    setProfileOpen(true);
  };

  const changeThemeColor = (nextTheme: ThemeColor) => {
    setThemeColor(nextTheme);
    if (authenticatedEmail) window.localStorage.setItem(`iljin-ai-theme:${authenticatedEmail}`, nextTheme);
  };

  const changeThemeMode = (nextMode: ThemeMode) => {
    setThemeMode(nextMode);
    if (authenticatedEmail) window.localStorage.setItem(`iljin-ai-theme-mode:${authenticatedEmail}`, nextMode);
  };

  const toggleSidebar = () => {
    const nextCollapsed = !sidebarCollapsed;
    setSidebarCollapsed(nextCollapsed);
    if (authenticatedEmail) window.localStorage.setItem(`iljin-ai-sidebar:${authenticatedEmail}`, nextCollapsed ? "collapsed" : "expanded");
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!profileDraft.displayName.trim() || !profileDraft.department.trim() || profileSaving) return;
    const changingPassword = Boolean(passwordDraft.current || passwordDraft.next || passwordDraft.confirmation);
    if (changingPassword && (!passwordDraft.current || !passwordDraft.next || !passwordDraft.confirmation)) {
      setProfileError("비밀번호를 변경하려면 현재 비밀번호와 새 비밀번호를 모두 입력해 주세요.");
      return;
    }
    if (changingPassword && passwordDraft.next !== passwordDraft.confirmation) {
      setProfileError("새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setProfileSaving(true);
    setProfileError("");
    try {
      const response = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          ...profileDraft,
          ...(changingPassword ? {
            currentPassword: passwordDraft.current,
            newPassword: passwordDraft.next,
          } : {}),
        }),
      });
      const payload = await response.json() as { user?: AccessUser; error?: { message?: string } };
      if (!response.ok || !payload.user) throw new Error(payload.error?.message || "개인정보를 저장하지 못했습니다.");
      setAccess({ state: payload.user.status, user: payload.user });
      setPasswordDraft({ current: "", next: "", confirmation: "" });
      setProfileOpen(false);
      setNotice("개인정보가 저장되었습니다.");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "개인정보를 저장하지 못했습니다.");
    } finally {
      setProfileSaving(false);
    }
  };

  if (access.state !== "approved") return <AccessGate access={access} onAuthenticated={(user) => setAccess({ state: user.status, user })} onSignedOut={() => setAccess({ state: "signed_out" })} onRetry={() => { setAccess({ state: "checking" }); setAccessCheckVersion((version) => version + 1); }} />;
  const currentUser = access.user;
  const canUse = (permission: string, feature?: string) => {
    const permitted = currentUser.permissions?.length
      ? currentUser.permissions.includes(permission)
      : currentUser.role === "admin" || !permission.startsWith("admin.");
    return permitted && (!feature || currentUser.features?.[feature] !== false);
  };
  const visibleNavigation = [...navItems, { id: "feedback" as View, label: "사용자 의견", mark: "FB", req: "U-09", permission: "workspace.home", icon: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5v-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/><path d="M8 8h8M8 11h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' }].filter((item) => item.id !== "admin").filter((item) => canUse(item.permission, item.feature));

  return (
    <div className={`app-shell operation-console theme-${themeColor} mode-${resolvedThemeMode}`}>
      <a className="skip-link" href="#main-content">본문으로 바로가기</a>
      <aside ref={navigationRef} id="mobile-navigation" className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} aria-label="주요 메뉴">
        <div className="brand-lockup">
          {sidebarCollapsed
            ? <Image src="/iljin-logo.png" alt="ILJIN" width={24} height={24} priority unoptimized style={{ borderRadius: "4px" }} />
            : <Image src="/iljin-logo.png" alt="ILJIN" width={88} height={20} priority unoptimized />}
          {!sidebarCollapsed && <span>AI Works</span>}
        </div>
        <nav className="primary-nav">
          {!sidebarCollapsed && <p className="nav-eyebrow">WORKSPACE</p>}
          {visibleNavigation.map((item) => (
            <button key={item.id} type="button" className={view === item.id ? "nav-item active" : "nav-item"} onClick={() => navigate(item.id)} aria-current={view === item.id ? "page" : undefined} aria-label={sidebarCollapsed ? item.label : undefined} title={sidebarCollapsed ? item.label : undefined}>
              <span className="nav-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${item.icon}</svg>` }} />
              {!sidebarCollapsed && <span className="nav-label">{item.label}</span>}
              {item.id === "approvals" && activityDashboard.summary.pendingApprovals > 0 && <span className="nav-count" aria-label={`대기 ${activityDashboard.summary.pendingApprovals}건`}>{activityDashboard.summary.pendingApprovals}</span>}
            </button>
          ))}
          {currentUser.role === "admin" && canUse("admin.permissions") && <>
            {!sidebarCollapsed && <p className="nav-eyebrow nav-section">MANAGEMENT</p>}
            <button type="button" className={view === "admin" ? "nav-item active" : "nav-item"} onClick={() => navigate("admin")} aria-current={view === "admin" ? "page" : undefined} aria-label={sidebarCollapsed ? adminNavigationItem.label : undefined} title={sidebarCollapsed ? adminNavigationItem.label : undefined}>
              <span className="nav-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${adminNavigationItem.icon}</svg>` }} />
              {!sidebarCollapsed && <span className="nav-label">{adminNavigationItem.label}</span>}
            </button>
          </>}
        </nav>
        <div className="sidebar-foot">
          <div className="security-state" title={apiStatus.detail}><span className={`status-dot status-dot-${apiStatus.state}`} /> {!sidebarCollapsed && apiStatus.label}</div>
          {!sidebarCollapsed && <p>권한·부서 Context 적용</p>}
        </div>
        <button type="button" className="sidebar-toggle" aria-controls="mobile-navigation" aria-expanded={!sidebarCollapsed} aria-label={sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"} title={sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"} onClick={toggleSidebar}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ transform: sidebarCollapsed ? "rotate(180deg)" : "none", transition: "transform 200ms ease" }}>
            <path d="M15 18l-6-6 6-6" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
        </button>
      </aside>
      {mobileNavOpen && <button className="nav-scrim" type="button" aria-label="메뉴 닫기" onClick={() => setMobileNavOpen(false)} />}

      <div className="app-stage" inert={mobileNavOpen ? true : undefined}>
        <header className="topbar">
          <button ref={menuButtonRef} className="menu-button" type="button" aria-expanded={mobileNavOpen} aria-controls="mobile-navigation" onClick={() => setMobileNavOpen((open) => !open)}>메뉴</button>
          <div className="page-identity">
            <span>AI Works</span>
            <strong>{displayedLabel}</strong>
          </div>
          <div className="topbar-actions">
            <time className="live-clock" dateTime={currentTime?.toISOString()} title="한국 표준시 (Asia/Seoul)">
              <span className="live-clock-date">{currentTime ? kstDateFormatter.format(currentTime) : "--.-- ---"}</span>
              <strong>{currentTime ? kstTimeFormatter.format(currentTime) : "--:--:--"}</strong>
              <small>KST</small>
            </time>
            <button className="notification-button" type="button" aria-label={`알림 ${activityDashboard.notifications.length}개`} aria-expanded={notificationOpen} onClick={() => setNotificationOpen((open) => !open)}>{activityDashboard.notifications.length}</button>
            {notificationOpen && <div className="notification-popover" role="dialog" aria-label="운영 알림">
              <div className="notification-heading"><strong>알림</strong><button type="button" className="text-button" onClick={() => setNotificationOpen(false)}>닫기</button></div>
              {activityDashboard.notifications.length === 0
                ? <p className="empty-state">확인할 새 알림이 없습니다.</p>
                : activityDashboard.notifications.map((item) => <button key={item.id} type="button" className={`notification-item notification-${item.level}`} onClick={() => { navigate(item.target === "documents" ? "search" : item.target); setNotificationOpen(false); }}>
                  <span className="notification-mark" /><span><strong>{item.title}</strong><small>{item.description}</small></span>
                </button>)}
            </div>}
            <button className="profile-button" type="button" aria-label="프로필 수정" title="프로필 수정" onClick={openProfile}>
              <span className="avatar">{currentUser.displayName.slice(0, 1)}</span>
              <span className="profile-copy"><strong>{currentUser.displayName}</strong><small>{currentUser.department}</small></span>
            </button>
            <button className="logout-button" type="button" onClick={signOut} aria-label="로그아웃">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M9 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M13 8l4 4-4 4M8 12h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="logout-label">로그아웃</span>
            </button>
          </div>
        </header>

        <main id="main-content" className={`main-content${view === "feedback" ? " main-content-feedback" : ""}${view === "chat" ? " main-content-chat" : ""}`} tabIndex={-1}>
          {view === "home" && (
            <HomeView scope={scope} setScope={setScope} cases={visibleUseCases} user={currentUser} activity={activityDashboard} onNavigate={navigate} onOpenConversation={openConversation} onPrompt={(prompt) => { setQuery(prompt); navigate("chat"); }} />
          )}
          {view === "chat" && (
            <ChatView messages={chatMessages} query={query} setQuery={setQuery} sensitivity={chatSensitivity} setSensitivity={changeChatSensitivity} searchScope={chatSearchScope} setSearchScope={changeChatSearchScope} answerLength={chatAnswerLength} setAnswerLength={setChatAnswerLength} providerAvailability={providerAvailability} streaming={streaming} generationStage={generationStage} generationElapsedMs={generationElapsedMs} currentUser={currentUser} conversationId={conversationId} suggestedQuestions={activityDashboard.suggestedQuestions} canUpload={canUse("documents.manage", "documents.upload")} onEnsureConversation={ensureConversationForAttachment} onNewConversation={startNewConversation} onOpenConversation={openConversation} onFeedback={submitFeedback} onSubmit={submitChat} onStop={stopChat} onKeyDown={handleComposerKey} onOpenAgent={() => navigate("tasks")} onFollowUpClick={submitChatWithText} onClarificationSubmit={submitClarification} />
          )}
          {view === "search" && <SearchView type={searchType} setType={setSearchType} canUpload={canUse("documents.manage", "documents.upload")} onChat={(prompt, nextScope) => { changeChatSearchScope(nextScope); setQuery(prompt); navigate("chat"); }} />}
          {view === "tasks" && <AgentTasksView currentUser={{ role: currentUser.role }} />}
          {view === "approvals" && <ToolApprovalsView currentUser={{ email: currentUser.email, role: currentUser.role }} />}
          {view === "activity" && <ActivityView onNavigate={navigate} onOpenConversation={openConversation} />}
          {view === "schedule" && <ScheduleView />}
          {view === "feedback" && <FeedbackBoard />}
          {view === "admin" && currentUser.role === "admin" && canUse("admin.permissions") && <AdminView currentEmail={currentUser.email} />}
        </main>
      </div>

      {profileOpen && (
        <div className="modal-overlay profile-modal-overlay" onClick={() => setProfileOpen(false)}>
          <section className="modal-content profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal-heading">
              <div><span className="section-kicker">ACCOUNT</span><h2 id="profile-modal-title">개인정보 수정</h2></div>
              <button className="text-button" type="button" onClick={() => setProfileOpen(false)} aria-label="개인정보 수정 창 닫기">닫기</button>
            </div>
            <form className="profile-form" onSubmit={saveProfile}>
              <label><span>이메일</span><input value={currentUser.email} readOnly disabled /></label>
              <label><span>이름</span><input value={profileDraft.displayName} onChange={(event) => setProfileDraft((draft) => ({ ...draft, displayName: event.target.value }))} maxLength={120} autoComplete="name" required /></label>
              <label><span>소속 부서</span><input value={profileDraft.department} onChange={(event) => setProfileDraft((draft) => ({ ...draft, department: event.target.value }))} maxLength={120} required /></label>
              <fieldset className="password-picker">
                <legend>비밀번호 변경</legend>
                <p className="field-hint">변경하지 않으려면 비워 두세요. 새 비밀번호는 12자 이상이어야 합니다.</p>
                <label><span>현재 비밀번호</span><input type="password" value={passwordDraft.current} onChange={(event) => setPasswordDraft((draft) => ({ ...draft, current: event.target.value }))} autoComplete="current-password" maxLength={128} /></label>
                <label><span>새 비밀번호</span><input type="password" value={passwordDraft.next} onChange={(event) => setPasswordDraft((draft) => ({ ...draft, next: event.target.value }))} autoComplete="new-password" minLength={12} maxLength={128} /></label>
                <label><span>새 비밀번호 확인</span><input type="password" value={passwordDraft.confirmation} onChange={(event) => setPasswordDraft((draft) => ({ ...draft, confirmation: event.target.value }))} autoComplete="new-password" minLength={12} maxLength={128} /></label>
              </fieldset>
              <fieldset className="theme-picker">
                <legend>플랫폼 컬러 팔레트</legend>
                <div className="theme-choice-grid" role="radiogroup" aria-label="플랫폼 컬러 팔레트">
                  {themeColorOptions.map((option) => (
                    <button key={option.value} type="button" className={`theme-choice theme-choice-${option.value} ${themeColor === option.value ? "selected" : ""}`} aria-pressed={themeColor === option.value} onClick={() => changeThemeColor(option.value)}>
                      <span className="theme-swatch" aria-hidden="true" />
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="theme-mode-picker">
                <legend>화면 모드</legend>
                <div className="theme-mode-choice-grid" role="radiogroup" aria-label="화면 모드">
                  {(["light", "dark", "system"] as const).map((mode) => (
                    <button key={mode} type="button" className={`theme-mode-choice ${themeMode === mode ? "selected" : ""}`} aria-pressed={themeMode === mode} onClick={() => changeThemeMode(mode)}>
                      <span className={`theme-mode-icon theme-mode-icon-${mode}`} aria-hidden="true" />
                      <span>{mode === "light" ? "라이트" : mode === "dark" ? "다크" : "시스템"}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              {profileError && <p className="form-error" role="alert">{profileError}</p>}
              <div className="modal-actions">
                <button type="button" className="button button-secondary" onClick={() => setProfileOpen(false)}>취소</button>
                <button type="submit" className="button button-primary" disabled={profileSaving || !profileDraft.displayName.trim() || !profileDraft.department.trim()}>{profileSaving ? "저장 중..." : "저장"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      <div className="sr-only" aria-live="polite">{notice}</div>
    </div>
  );
}

function HomeView({ scope, setScope, cases, user, activity, onNavigate, onOpenConversation, onPrompt }: {
  scope: Scope;
  setScope: (scope: Scope) => void;
  cases: UseCase[];
  user: AccessUser;
  activity: ActivityDashboard;
  onNavigate: (view: View) => void;
  onOpenConversation: (id: string) => void;
  onPrompt: (prompt: string) => void;
}) {
  const [draft, setDraft] = useState("");

  return (
    <div className="view-stack">
      <section className="hero-panel">
        <div className="hero-copy">
          <h1>좋은 하루예요, {user.displayName}님. <em>업무를 어디서부터 시작할까요?</em></h1>
          <p>{user.department} 업무 Context를 반영해 안전하게 답변합니다.</p>
        </div>
        <div className="hero-stats" aria-label="오늘의 업무 현황">
          <div><strong>{activity.summary.todayActivities}</strong><span>오늘 활동</span></div>
          <div><strong>{activity.summary.pendingApprovals}</strong><span>승인 대기</span></div>
          <div><strong>{activity.summary.enabledTools}</strong><span>사용 가능 Tool</span></div>
        </div>
        <form className="hero-composer" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) onPrompt(draft.trim()); }}>
          <label className="sr-only" htmlFor="home-question">AI에게 질문하기</label>
          <input id="home-question" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="규정, 설비, 업무시스템에 대해 질문하세요" />
          <button className="button button-primary" type="submit">질문하기</button>
        </form>
        <div className="suggestion-row" aria-label="추천 질문">
          {["오늘 업무 브리핑", "사업 KPI 요약", "출장 규정 확인"].map((item) => <button key={item} type="button" onClick={() => onPrompt(item)}>{item}</button>)}
        </div>
      </section>

      <section className="section-block" aria-labelledby="work-title">
        <div className="section-heading">
          <div><span className="section-kicker">WORK EXAMPLES</span><h2 id="work-title">업무 예시</h2><p>제조·품질·공급망 업무에 활용할 수 있습니다.</p></div>
          <div className="segmented" role="group" aria-label="업무 범위 선택">
            <button type="button" className={scope === "personal" ? "selected" : ""} aria-pressed={scope === "personal"} onClick={() => setScope("personal")}>개인별 8</button>
            <button type="button" className={scope === "department" ? "selected" : ""} aria-pressed={scope === "department"} onClick={() => setScope("department")}>부서별 13</button>
          </div>
        </div>
        <div className="usecase-grid">
          {cases.map((item) => (
            <article className="usecase-card" key={item.title}>
              <div className="card-topline"><span className={`risk risk-${item.risk.toLowerCase()}`}>{item.risk}</span><span>{item.audience}</span></div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <div className="source-list">{item.sources.map((source) => <span key={source}>{source}</span>)}</div>
              <dl className="card-meta"><div><dt>Agent</dt><dd>{item.agent}</dd></div><div><dt>결과</dt><dd>{item.output}</dd></div></dl>
              <button type="button" className="card-action" onClick={() => onPrompt(item.prompt)}>이 업무 시작하기 <span aria-hidden="true">→</span></button>
            </article>
          ))}
        </div>
      </section>

      <section className="home-bottom-grid">
        <div className="panel recent-panel">
          <div className="panel-title"><div><span className="section-kicker">RECENT</span><h2>최근 업무</h2></div><button type="button" className="text-button" onClick={() => onNavigate("activity")}>전체 보기</button></div>
          {activity.items.length === 0 && <p className="empty-state">아직 저장된 업무 활동이 없습니다.</p>}
          {activity.items.slice(0, 3).map((item, index) => <button type="button" className="recent-row" key={item.id} onClick={() => item.target === "chat" && item.resourceId ? onOpenConversation(item.resourceId) : onNavigate(item.target === "documents" ? "search" : item.target)}><span className="recent-mark">{index + 1}</span><span><strong>{item.title}</strong><small>{new Date(item.createdAt).toLocaleString("ko-KR")}</small></span><span aria-hidden="true">→</span></button>)}
        </div>
        <div className="panel context-panel">
          <span className="section-kicker">YOUR CONTEXT</span><h2>현재 적용 중인 권한</h2>
          <div className="context-user"><span className="avatar avatar-large">{user.displayName.slice(0, 1)}</span><div><strong>{user.displayName} · {user.department}</strong><p>{user.role === "admin" ? "관리자 운영·권한 설정 가능" : user.role === "manager" ? "부서 업무·Tool 승인 가능" : "개인 업무·허용 문서 조회 가능"}</p></div></div>
          <ul><li><span className="status-dot" /> 이메일 계정·보안 세션 식별</li><li><span className="status-dot" /> 서버 권한 프로필 적용</li><li><span className="status-dot" /> Cloudflare AI 라우팅 설정</li></ul>
        </div>
      </section>
    </div>
  );
}

function ClarificationForm({
  questions,
  originalQuestion,
  disabled,
  onSubmit,
}: {
  questions: FollowUpQuestion[];
  originalQuestion: string;
  disabled: boolean;
  onSubmit: (originalQuestion: string, questions: FollowUpQuestion[], answers: string[]) => void;
}) {
  const [answers, setAnswers] = useState(() => questions.map(() => ""));
  const complete = answers.every((answer) => answer.trim().length > 0);

  return (
    <form
      className="clarification-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!complete || disabled) return;
        onSubmit(originalQuestion, questions, answers);
      }}
    >
      <div className="clarification-form-heading">
        <div>
          <span className="section-kicker">BEFORE ANSWERING</span>
          <strong>정확한 답변을 위한 보충 질문</strong>
        </div>
        <small>모든 항목을 입력하면 최종 답변 생성을 시작합니다.</small>
      </div>
      <div className="clarification-fields">
        {questions.map((item, index) => (
          <label key={`${item.question}-${index}`}>
            <span><b>{index + 1}</b>{item.question}</span>
            <small>{item.intent}</small>
            <textarea
              rows={2}
              value={answers[index]}
              disabled={disabled}
              placeholder="알고 있는 정보를 입력하세요. 해당 사항이 없으면 ‘해당 없음’으로 입력하세요."
              onChange={(event) => setAnswers((current) =>
                current.map((answer, answerIndex) => answerIndex === index ? event.target.value : answer)
              )}
            />
          </label>
        ))}
      </div>
      <button className="button button-primary" type="submit" disabled={!complete || disabled}>
        {disabled ? "보충 정보 제출 완료" : "정보 제출하고 최종 답변 생성"}
      </button>
    </form>
  );
}

function ChatView({ messages, query, setQuery, sensitivity, setSensitivity, searchScope, setSearchScope, answerLength, setAnswerLength, providerAvailability, streaming, generationStage, generationElapsedMs, currentUser, conversationId, suggestedQuestions, canUpload, onEnsureConversation, onNewConversation, onOpenConversation, onFeedback, onSubmit, onStop, onKeyDown, onOpenAgent, onFollowUpClick, onClarificationSubmit }: {
  messages: ChatMessage[];
  query: string;
  setQuery: (value: string) => void;
  sensitivity: ChatSensitivity;
  setSensitivity: (value: ChatSensitivity) => void;
  searchScope: SearchScope;
  setSearchScope: (value: SearchScope) => void;
  answerLength: ChatAnswerLength;
  setAnswerLength: (value: ChatAnswerLength) => void;
  providerAvailability: { cloudflare: boolean; local: boolean; rag: boolean; internalSearch: boolean };
  streaming: boolean;
  generationStage: string;
  generationElapsedMs: number;
  currentUser: AccessUser;
  conversationId?: string;
  suggestedQuestions: ActivityDashboard["suggestedQuestions"];
  canUpload: boolean;
  onEnsureConversation: () => Promise<string>;
  onNewConversation: () => void | Promise<void>;
  onOpenConversation: (id: string) => void;
  onFeedback: (messageId: string, rating: 1 | -1) => void;
  onSubmit: (event: FormEvent, agent?: ChatAgent) => void;
  onStop: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onOpenAgent: () => void;
  onFollowUpClick: (text: string) => void;
  onClarificationSubmit: (originalQuestion: string, questions: FollowUpQuestion[], answers: string[]) => void;
}) {
  const [conversations, setConversations] = useState<Array<{ id: string; title: string; updated_at: string }>>([]);
  const [attachmentState, setAttachmentState] = useState("");
  const [conversationAttachments, setConversationAttachments] = useState<ConversationAttachmentItem[]>([]);
  const [copiedMessage, setCopiedMessage] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [agents, setAgents] = useState<ChatAgent[]>([]);
  const [agentMenuError, setAgentMenuError] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<ChatAgent>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  // Bumped on every attach so a stale poll from a previous file can detect it
  // has been superseded and stop writing to attachmentState.
  const attachmentGenerationRef = useRef(0);

  useEffect(() => () => { attachmentGenerationRef.current += 1; }, []);
  const activeStreamingMessage = [...messages].reverse().find((message) => message.streamingResponse);

  const loadConversationAttachments = async (id?: string) => {
    if (!id) {
      setConversationAttachments([]);
      return;
    }
    const response = await fetch(`/api/v1/conversations/${encodeURIComponent(id)}/attachments`, {
      cache: "no-store",
    });
    if (!response.ok) return;
    const payload = await response.json() as { items?: ConversationAttachmentItem[] };
    setConversationAttachments(payload.items || []);
  };

  useEffect(() => {
    let ignore = false;
    if (conversationId) {
      fetch(`/api/v1/conversations/${encodeURIComponent(conversationId)}/attachments`, { cache: "no-store" })
        .then(async (response) => {
          if (response.ok && !ignore) {
            const payload = await response.json() as { items?: ConversationAttachmentItem[] };
            setConversationAttachments(payload.items || []);
          }
        })
        .catch(() => {});
    }
    return () => { ignore = true; };
  }, [conversationId]);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/conversations?limit=12", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { conversations?: Array<{ id: string; title: string; updated_at: string }>; error?: { message?: string } };
        if (!response.ok) throw new Error("대화 목록을 불러오지 못했습니다.");
        return payload.conversations || [];
      })
      .then((items) => { if (active) setConversations(items); })
      .catch(() => { if (active) setConversations([]); });
    return () => { active = false; };
  }, [conversationId, messages.length]);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/agents", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { agents?: ChatAgent[]; error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message || "에이전트 목록을 불러오지 못했습니다.");
        return payload.agents || [];
      })
      .then((items) => { if (active) { setAgents(items); setAgentMenuError(""); } })
      .catch((error: unknown) => { if (active) setAgentMenuError(error instanceof Error ? error.message : "에이전트 목록을 불러오지 못했습니다."); });
    return () => { active = false; };
  }, []);

  const trimmedQuery = query.trimStart();
  const agentSearch = trimmedQuery.startsWith("/") ? trimmedQuery.slice(1).trim().toLocaleLowerCase("ko-KR") : "";
  const showAgentMenu = trimmedQuery.startsWith("/") && !selectedAgent;
  const matchedAgents = agents.filter((agent) => !agentSearch || agent.name.toLocaleLowerCase("ko-KR").includes(agentSearch));
  const selectAgent = (agent: ChatAgent) => {
    setSelectedAgent(agent);
    setQuery(`/${agent.name} `);
  };

  const insertAttachmentPrompt = (file: File, modality?: string) => {
    const attachmentKind = modality === "image" ? "첨부 이미지" : "첨부 문서";
    setQuery(`${query}${query.trim() ? "\n" : ""}[${attachmentKind}: ${file.name}] 이 자료의 텍스트·표·차트·이미지를 근거로 핵심 내용을 분석해 주세요.`);
  };

  // Large uploads return 202 with a jobId instead of a finished index (see
  // ASYNC_INGEST_THRESHOLD_BYTES in app/api/v1/assets/route.ts). Poll the asset
  // until the queue consumer finishes, rather than blocking the composer on a
  // request that can take minutes.
  const pollAssetUntilIndexed = async (file: File, assetId: string, generation: number, activeConversationId: string) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < ASSET_POLL_TIMEOUT_MS) {
      if (attachmentGenerationRef.current !== generation) return;
      await new Promise((resolve) => { globalThis.setTimeout(resolve, ASSET_POLL_INTERVAL_MS); });
      if (attachmentGenerationRef.current !== generation) return;
      let payload: AssetStatusResponse;
      try {
        const response = await fetch(`/api/v1/assets/${encodeURIComponent(assetId)}`, { cache: "no-store" });
        if (!response.ok) continue;
        payload = await response.json() as AssetStatusResponse;
      } catch {
        continue;
      }
      if (attachmentGenerationRef.current !== generation) return;
      if (payload.status === "indexed") {
        insertAttachmentPrompt(file);
        await loadConversationAttachments(activeConversationId);
        setAttachmentState(`📎 ${file.name} · 멀티모달 분석 · ${payload.segment_count || 0}개 근거 조각 등록 완료`);
        return;
      }
      if (payload.status === "failed") {
        setAttachmentState(payload.error_message || `${file.name} 색인에 실패했습니다.`);
        return;
      }
      setAttachmentState(`📎 ${file.name} · ${describeAssetProgress(payload)}`);
    }
    if (attachmentGenerationRef.current === generation) {
      setAttachmentState(`${file.name} 색인이 예상보다 오래 걸리고 있습니다. 잠시 후 대화·검색에서 다시 확인해 주세요.`);
    }
  };

  const attachDocument = async (file?: File) => {
    if (!file) return;
    const generation = ++attachmentGenerationRef.current;
    setAttachmentState("문서를 등록하고 있습니다.");
    try {
      const activeConversationId = await onEnsureConversation();
      const form = new FormData();
      form.set("file", file);
      form.set("title", file.name);
      form.set("classification", "internal");
      form.set("retention", "temporary");
      form.set("conversation_id", activeConversationId);
      const response = await fetch("/api/v1/assets", { method: "POST", body: form });
      const payload = await readUploadResponse(response);
      if (!response.ok) throw new Error(payload.error?.message || "문서를 등록하지 못했습니다.");
      await loadConversationAttachments(activeConversationId);
      if (response.status === 202 && payload.status === "queued" && payload.assetId) {
        setAttachmentState(`📎 ${file.name} · 대용량 문서라 백그라운드에서 색인을 시작했습니다.`);
        void pollAssetUntilIndexed(file, payload.assetId, generation, activeConversationId);
        return;
      }
      insertAttachmentPrompt(file, payload.multimodal?.modality);
      setAttachmentState(`+ ${file.name} · ${payload.multimodal ? "멀티모달 분석 · " : ""}${payload.segmentCount || 0}개 근거 조각 등록 완료`);
    } catch (error) {
      setAttachmentState(error instanceof Error ? error.message : "문서를 등록하지 못했습니다.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDragEnter = (event: ReactDragEvent<HTMLFormElement>) => {
    if (!canUpload || !providerAvailability.rag || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  };

  const handleDragOver = (event: ReactDragEvent<HTMLFormElement>) => {
    if (!canUpload || !providerAvailability.rag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: ReactDragEvent<HTMLFormElement>) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };

  const handleDrop = (event: ReactDragEvent<HTMLFormElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    if (!canUpload || !providerAvailability.rag) {
      setAttachmentState("+ 문서 첨부에는 Cloudflare RAG 연결이 필요합니다.");
      return;
    }
    const file = event.dataTransfer.files?.[0];
    if (file) void attachDocument(file);
  };

  const deleteConversationItem = async (id: string) => {
    const response = await fetch(`/api/v1/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) {
      setAttachmentState("대화를 삭제하지 못했습니다.");
      return;
    }
    setConversations((items) => items.filter((item) => item.id !== id));
    if (conversationId === id) onNewConversation();
  };

  const copyAnswer = async (message: ChatMessage, index: number) => {
    try {
      await navigator.clipboard.writeText(message.body);
      setCopiedMessage(`${index}`);
      globalThis.setTimeout(() => setCopiedMessage(""), 1600);
    } catch {
      setAttachmentState("답변을 클립보드에 복사하지 못했습니다.");
    }
  };

  return (
    <div className="workspace-layout">
      <section className="chat-workspace" aria-label="AI 채팅">
         <section className="chat-smart-suggestions" aria-labelledby="chat-smart-suggestions-title">
          <div className="chat-smart-suggestions-heading">
            <div>
              <span className="section-kicker">SMART SUGGESTIONS</span>
              <h2 id="chat-smart-suggestions-title">지금 확인하면 좋은 업무 질문</h2>
            </div>
            <span>{currentUser.department} 맞춤 · 최근 90일</span>
          </div>
          <div className="chat-smart-suggestion-list">
            <button className="button button-secondary chat-new-button" type="button" onClick={() => void onNewConversation()}>새 대화</button>
            {suggestedQuestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                disabled={streaming}
                onClick={() => onFollowUpClick(suggestion.question)}
                title={suggestion.question}
              >
                <span className={`suggestion-kind suggestion-kind-${suggestion.category}`}>
                  {suggestion.category === "frequent" ? "자주 찾음" : "최근 이슈"}
                </span>
                <strong>{suggestion.label}</strong>
                <small>{suggestion.meta}</small>
              </button>
            ))}
          </div>
        </section>
        <div className="message-list" aria-live="polite">
          {messages.length === 0 && <div className="chat-empty"><span className="message-avatar" aria-hidden="true">AI</span><div><strong>{currentUser.displayName}님, 무엇을 도와드릴까요?</strong><p>{searchScope === "internet" ? "상단의 최근 업무 이슈를 선택하거나, 인터넷 검색으로 공개 웹 자료에서 확인할 질문을 입력해 주세요." : "상단의 자주 찾는 질문을 선택하거나, 사내 문서·매뉴얼·규정에 대해 질문해 주세요."}</p></div></div>}
          {messages.map((message, index) => (
            <article className={`message ${message.role}${message.error ? " error" : ""}`} key={`${message.role}-${index}`}>
              <span className="message-avatar" aria-hidden="true">{message.role === "user" ? currentUser.displayName.slice(0, 1) : "AI"}</span>
              <div><div className={"message-label" + (message.streamingResponse && message.streamingStage ? " streaming-stage" : "")}>{message.role === "user" ? currentUser.displayName : message.streamingResponse && message.streamingStage ? "ILJIN AI · " + message.streamingStage + (message.tokenCount ? " (" + message.tokenCount + " 토큰)" : "") : message.clarificationRequired ? "ILJIN AI · 답변 전 정보 확인" : message.provider === "cloudflare" ? "ILJIN AI · Cloud LLM" : "ILJIN AI · 로컬"}</div>{message.streamingResponse && <GenerationProgress scope={searchScope} stage={message.streamingStage || generationStage} detail={message.streamingDetail} elapsedMs={generationElapsedMs} tokenCount={message.tokenCount} sources={message.citations} />}{message.role === "assistant" && !message.error ? <>{message.streamingResponse && message.streamingSummary && <div className="answer-summary" aria-live="polite"><span>빠른 요약</span><p>{message.streamingSummary}</p></div>}<FormattedAnswer content={message.body} citations={message.citations ? buildCitationLookup(message.citations) : undefined} /></> : <p>{message.body}</p>}{message.role === "assistant" && message.clarificationRequired && message.followUpQuestions?.length && message.clarificationOriginalQuestion ? <ClarificationForm questions={message.followUpQuestions} originalQuestion={message.clarificationOriginalQuestion} disabled={streaming || messages.slice(index + 1).some((item) => item.role === "user")} onSubmit={onClarificationSubmit} /> : message.role === "assistant" && message.followUpQuestions && message.followUpQuestions.length > 0 && <div className="follow-up-questions"><span className="follow-up-label">정확한 답변을 위한 보충 질문</span>{message.followUpQuestions.map((fq, fqIndex) => <button key={fqIndex} type="button" className="follow-up-button" disabled={streaming} onClick={() => onFollowUpClick(fq.question)} title={fq.intent}>{fq.question}</button>)}</div>}{message.role === "assistant" && message.relatedQuestions && message.relatedQuestions.length > 0 && <div className="follow-up-questions related-questions"><span className="follow-up-label">연관 질문 추천</span>{message.relatedQuestions.map((rq, rqIndex) => <button key={rqIndex} type="button" className="follow-up-button related-question-button" disabled={streaming} onClick={() => onFollowUpClick(rq.question)} title={rq.intent}>{rq.question}</button>)}</div>}{message.role === "assistant" && !message.clarificationRequired && <div className="answer-actions"><button type="button" onClick={() => void copyAnswer(message, index)}>{copiedMessage === `${index}` ? "복사됨" : "답변 복사"}</button>{message.error && <button type="button" onClick={() => setQuery([...messages].slice(0, index).reverse().find((item) => item.role === "user")?.body || "")}>질문 다시 입력</button>}{message.messageId && <><button type="button" className={`answer-feedback-button ${message.feedback === 1 ? "selected positive" : ""}`} aria-label="답변 좋아요" title="좋아요" disabled={Boolean(message.feedback)} onClick={() => onFeedback(message.messageId!, 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v10H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3Zm0 10h9.6a2 2 0 0 0 1.95-1.58l1.2-6A2 2 0 0 0 17.8 10H14l.7-3.5A2 2 0 0 0 12.75 4L8 10v10Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" /></svg><span>좋아요</span></button><button type="button" className={`answer-feedback-button ${message.feedback === -1 ? "selected negative" : ""}`} aria-label="답변 싫어요" title="싫어요" disabled={Boolean(message.feedback)} onClick={() => onFeedback(message.messageId!, -1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14V4H4a1 1 0 0 1-1 1v8a1 1 0 0 1 1 1h3Zm0-10h9.6a2 2 0 0 1 1.95 1.58l1.2 6A2 2 0 0 1 17.8 14H14l.7 3.5A2 2 0 0 1 12.75 20L8 14V4Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" /></svg><span>싫어요</span></button></>}<span className="trace">{message.traceId ? `${message.model ?? "@cf/zai-org/glm-4.7-flash"} · ${message.latencyMs ?? 0}ms · ${message.traceId}` : message.error ? "Gateway 연결 오류" : "저장된 응답"}</span></div>}</div>
              {message.role === "assistant" && message.traceId && !message.streamingResponse && <div className="answer-usage">{message.tokenCount?.toLocaleString() ?? "토큰 계산 중"} · {(message.latencyMs ?? 0) >= 1_000 ? `${((message.latencyMs ?? 0) / 1_000).toFixed(1)}초` : `${message.latencyMs ?? 0}ms`}</div>}
            </article>
          ))}
          {streaming && !messages.some((message) => message.streamingResponse) && <article className="message assistant streaming"><span className="message-avatar" aria-hidden="true">AI</span><div><div className="message-label">ILJIN AI</div><GenerationProgress scope={searchScope} stage={generationStage} elapsedMs={generationElapsedMs} /></div></article>}
        </div>
        <form className={`chat-composer${dragActive ? " is-dragging" : ""}`} onSubmit={(event) => { onSubmit(event, selectedAgent); setSelectedAgent(undefined); }} onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          <div className="composer-controls-row">
            <div className="search-scope-switch search-scope-switch--compact" role="group" aria-label="대화 검색 범위">
              <button type="button" className={searchScope === "internal" ? "selected" : ""} aria-pressed={searchScope === "internal"} disabled={streaming || !providerAvailability.internalSearch} onClick={() => setSearchScope("internal")}>내부</button>
              <button type="button" className={searchScope === "internet" ? "selected" : ""} aria-pressed={searchScope === "internet"} disabled={streaming} onClick={() => setSearchScope("internet")}>인터넷</button>
            </div>
            <select id="chat-sensitivity" value={sensitivity} disabled={streaming || searchScope === "internet"} onChange={(event) => setSensitivity(event.target.value as ChatSensitivity)}>{searchScope === "internet" ? <option value="public">공개 · 인터넷</option> : <><option value="internal">내부 · Cloudflare</option><option value="confidential" disabled={!providerAvailability.local}>기밀 · 로컬</option></>}</select>
            <label className="control-inline"><span>답변 분량</span><select id="chat-answer-length" value={answerLength} disabled={streaming} onChange={(event) => setAnswerLength(event.target.value as ChatAnswerLength)}><option value="brief">핵심 · 빠른 답</option><option value="standard">표준 · 균형</option><option value="detailed">심층 · 의사결정</option></select></label>
          </div>
          <div className="composer-input-row">
            <div className="composer-attach-slot">{canUpload && <><input ref={fileInputRef} className="sr-only" type="file" accept=".txt,.md,.csv,.json,.pdf,.jpg,.jpeg,.png,.webp,.svg,.gif,.bmp,text/plain,text/markdown,text/csv,application/json,application/pdf,image/*" onChange={(event) => void attachDocument(event.target.files?.[0])} /><button type="button" className="quiet-button composer-attach-btn" aria-label="멀티모달 첨부" disabled={!providerAvailability.rag} onClick={() => fileInputRef.current?.click()}>+</button></>}</div>
            <div className="composer-query-wrap">
              {selectedAgent && <span className="chat-agent-chip"><strong>/{selectedAgent.name}</strong><button type="button" onClick={() => { setSelectedAgent(undefined); setQuery(query.replace(`/${selectedAgent.name}`, "").trimStart()); }} aria-label={`${selectedAgent.name} 선택 해제`}>×</button></span>}
              <textarea id="chat-question" rows={1} value={query} onChange={(event) => { const value = event.target.value; setQuery(value); if (selectedAgent && !value.trimStart().startsWith(`/${selectedAgent.name}`)) setSelectedAgent(undefined); }} onKeyDown={onKeyDown} placeholder="질문을 입력하거나 /로 에이전트를 호출하세요" />
            </div>
            <div className="composer-send-slot">{streaming ? <button className="button button-secondary" type="button" onClick={onStop}>답변 중단</button> : <button className="button button-primary composer-send-btn" type="submit" disabled={!query.trim()}>보내기</button>}</div>
          </div>
          {showAgentMenu && <div className="chat-agent-menu" role="listbox" aria-label="에이전트 호출 목록">
            {agentMenuError ? <p role="alert">{agentMenuError}</p>
              : matchedAgents.length ? matchedAgents.map((agent) => <button key={agent.id} type="button" role="option" aria-selected={false} onClick={() => selectAgent(agent)}><strong>/{agent.name}</strong><span>{agent.instructions}</span></button>)
              : <p>호출할 에이전트가 없습니다. 작업 메뉴에서 새 에이전트를 만들어 주세요.</p>}
          </div>}
          {dragActive && <div className="composer-drop-hint" aria-hidden="true"><strong>+ 여기에 문서를 놓으세요</strong><span>문서 · PDF · 이미지 · 표 · 차트</span></div>}
          {conversationAttachments.length > 0 && (
            <div className="temporary-attachments" aria-label="대화 임시 첨부파일">
              <div>
                <strong>대화 임시 첨부</strong>
                <span>이 대화에서만 검색되며 새 대화를 시작하거나 대화를 삭제하면 원본과 인덱스가 함께 삭제됩니다.</span>
              </div>
              <ul>
                {conversationAttachments.map((attachment) => (
                  <li key={attachment.asset_id}>
                    <span aria-hidden="true">📎</span>
                    <strong>{attachment.title}</strong>
                    <small>{attachment.status === "indexed" ? `${attachment.segment_count}개 근거 준비` : "인덱싱 중"}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {attachmentState && <small className="attachment-state" role="status">{attachmentState}</small>}
        </form>
      </section>
      <aside className="context-rail" aria-label="대화 Context">
        <div className="rail-section"><span className="section-kicker">ACTIVE AGENT</span><h2>{selectedAgent ? selectedAgent.name : "선택된 에이전트 없음"}</h2><p>{selectedAgent ? selectedAgent.instructions : "채팅 입력창에서 /를 입력해 등록한 에이전트를 호출하세요."}</p></div>
        <div className="rail-section"><span className="section-kicker">CONTEXT</span><ul className="clean-list"><li>{currentUser.department} 권한</li><li>{currentUser.role} 역할 정책</li><li>Tenant·문서등급 ACL</li></ul></div>
        <div className="rail-section conversation-history"><span className="section-kicker">CONVERSATIONS</span><h2>최근 대화</h2>{conversations.length === 0 ? <p>저장된 대화가 없습니다.</p> : conversations.slice(0, 6).map((conversation) => <div className={conversationId === conversation.id ? "conversation-row active" : "conversation-row"} key={conversation.id}><button type="button" onClick={() => onOpenConversation(conversation.id)}><strong>{conversation.title}</strong><small>{new Date(conversation.updated_at).toLocaleString("ko-KR")}</small></button><button type="button" className="conversation-delete" aria-label={`${conversation.title} 삭제`} onClick={() => void deleteConversationItem(conversation.id)}>×</button></div>)}</div>
        <div className="rail-section"><span className="section-kicker">TOOL ACTION</span><p>R2 이상 Tool은 서버가 별도 승인 요청을 만들고 승인 전 실행을 차단합니다.</p><button className="button button-secondary full-button" type="button" onClick={onOpenAgent}>실제 Agent 실행 열기</button></div>
      </aside>
    </div>
  );
}

type KnowledgeAsset = {
  id: string;
  title: string;
  source_type: string;
  mime_type: string;
  status: string;
  classification: string;
  department_scope: string;
  version: number;
  segment_count: number;
  original_size?: number;
  original_uploaded_at?: string;
  embedding_model?: string;
  embedding_dimensions?: number;
  updated_at: string;
};

type KnowledgeOverview = {
  items: KnowledgeAsset[];
  recent: KnowledgeAsset[];
  categories: Array<{ sourceType: string; label: string; count: number }>;
  summary: {
    totalDocuments: number;
    indexedDocuments: number;
    processingDocuments: number;
    failedDocuments: number;
    totalSegments: number;
    recentUpdates: number;
    sourceCount: number;
    totalBytes: number;
    vectorCoverage: number;
    embeddingModel?: string;
    embeddingDimensions?: number;
    latestUpdatedAt?: string;
    department: string;
  };
};

function knowledgeStatusLabel(status: string) {
  if (status === "indexed") return "색인 완료";
  if (status === "queued" || status === "indexing" || status === "processing") return "처리 중";
  if (status === "failed") return "검토 필요";
  return status || "상태 미확인";
}

function SearchView({ type, setType, canUpload, onChat }: { type: string; setType: (type: string) => void; canUpload: boolean; onChat: (prompt: string, scope: SearchScope) => void }) {
  const [term, setTerm] = useState("");
  const [scope, setScope] = useState<SearchScope>("internal");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [results, setResults] = useState<RagResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | undefined>();
  const [hasSearched, setHasSearched] = useState(false);
  const [searchMeta, setSearchMeta] = useState<{ traceId?: string; retrievalLabel?: string }>({});
  const [sourceFilter, setSourceFilter] = useState("");
  const [periodFilter, setPeriodFilter] = useState("all");
  const [overview, setOverview] = useState<KnowledgeOverview>();
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState("");
  const [catalogRefreshKey, setCatalogRefreshKey] = useState(0);

  const refreshOverview = () => {
    setOverviewError("");
    setOverviewLoading(true);
    setCatalogRefreshKey((key) => key + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/knowledge-base", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await readApiPayload<KnowledgeOverview>(response);
        if (!response.ok) throw new Error(payload.error?.message || "지식 베이스를 불러오지 못했습니다.");
        return payload;
      })
      .then((payload) => {
        setOverview(payload);
        setOverviewError("");
      })
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setOverviewError(loadError instanceof Error ? loadError.message : "지식 베이스를 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setOverviewLoading(false);
      });
    return () => controller.abort();
  }, [catalogRefreshKey]);

  const visibleResults = useMemo(() => {
    const sourceType = type === "문서" ? "document" : type === "이미지" ? "image" : type === "영상" ? "video" : null;
    return sourceType ? results.filter((result) => result.sourceType === sourceType) : results;
  }, [results, type]);

  const executeSearch = async (queryInput: string, requestedScope: SearchScope = scope) => {
    const query = queryInput.trim();
    if (query.length < 2 || loading) return;
    setTerm(query);
    setLoading(true);
    setHasSearched(true);
    setError(null);
    setSubmittedQuery(query);
    try {
      const response = await fetch(requestedScope === "internal" ? "/api/v1/search" : "/api/v1/internet-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          limit: 10,
          ...(requestedScope === "internal" ? {
            sourceType: sourceFilter || undefined,
            createdFrom: periodFilter === "all"
              ? undefined
              : new Date(Date.now() - Number(periodFilter) * 24 * 60 * 60 * 1000).toISOString(),
          } : {}),
        }),
      });
      const payload = await readApiPayload<{
        citations?: GatewayResponse["citations"];
        results?: Array<{
          id: string;
          title: string;
          url: string;
          snippet: string;
          score: number;
          source: string;
          sourceCategory?: "government" | "academic" | "reference" | "web";
          sourceCategoryLabel?: string;
          publishedAt?: string;
        }>;
          provider?: "tavily" | "exa" | "google" | "naver" | "youtube" | "brave" | "webpilot" | "duckduckgo" | "jina" | "wikimedia";
        providersUsed?: string[];
        latencyMs?: number;
        traceId?: string;
        retrieval?: { strategy?: string; fusionStrategy?: "rrf"; queryType?: string; queryModality?: "text" | "image" | "table" | "chart" | "multimodal"; queryVariants?: string[]; embeddingModel?: string; embeddingProvider?: "cloudflare"; embeddingFallbackUsed?: boolean; embeddingDimensions?: number; rerankModel?: string; rerankProvider?: "cloudflare"; rerankStatus?: "applied" | "not_configured" | "fallback"; candidateCount?: number; fusionCandidateCount?: number; rerankCandidateCount?: number; evidenceConfidence?: number; verifierStatus?: "passed" | "insufficient" };
      }>(response);
      if (!response.ok) throw new Error(payload.error?.message || "검색 요청을 처리하지 못했습니다.");
      setResults(requestedScope === "internal"
        ? (payload.citations || []).map((citation) => ({
          id: citation.segmentId,
          title: citation.title,
          sourceType: citation.sourceType === "image" ? "image" as const : citation.sourceType === "audio" ? "audio" as const : citation.sourceType === "video" ? "video" as const : "document" as const,
          snippet: citation.excerpt,
          citation: citation.excerpt,
          score: citation.score,
          page: citation.pageNumber,
          section: citation.heading,
          chunkId: citation.segmentId,
          fileName: citation.title,
          fileType: "document",
          sourceLabel: citation.id,
          owner: "ILJIN",
          updatedAt: formatSearchDate(citation.updatedAt),
          version: citation.version ? `v${citation.version}` : "버전 미확인",
          sourceUrl: `/api/v1/citations?asset_id=${encodeURIComponent(citation.assetId)}&segment_id=${encodeURIComponent(citation.segmentId)}`,
          regionId: citation.regionId,
          regionType: citation.regionType,
          region: citation.region,
          originalUrl: citation.originalUrl,
        }))
        : (payload.results || []).map((result) => ({
          id: result.id,
          title: result.title,
          sourceType: "web" as const,
          snippet: result.snippet,
          citation: result.snippet,
          score: result.score,
          fileType: "web",
          sourceLabel: result.source,
          owner: result.source,
          updatedAt: formatSearchDate(result.publishedAt),
          version: result.sourceCategoryLabel || "공개 웹",
          sourceUrl: result.url,
        })));
      setElapsedMs(payload.latencyMs);
      setSearchMeta({
        traceId: payload.traceId || response.headers.get("X-Trace-Id") || undefined,
        retrievalLabel: requestedScope === "internet"
          ? `Internet · ${internetProvidersSummary(payload.providersUsed) || internetProviderLabel(payload.provider)}`
          : payload.retrieval
          ? `${payload.retrieval.strategy === "hybrid-rrf" ? "Hybrid · RRF" : payload.retrieval.strategy || "Search"} · ${payload.retrieval.queryModality && payload.retrieval.queryModality !== "text" ? `${payload.retrieval.queryModality.toUpperCase()} Router · ` : ""}질의 변형 ${payload.retrieval.queryVariants?.length || 1}개 · Cloudflare Embedding · ${payload.retrieval.rerankStatus === "applied" ? "Cloudflare Reranker" : payload.retrieval.rerankStatus === "fallback" ? "Hybrid 점수 폴백" : "Reranker 미구성"} · 근거 검증 ${payload.retrieval.verifierStatus === "passed" ? "통과" : "부족"} ${Math.round((payload.retrieval.evidenceConfidence || 0) * 100)}%${payload.retrieval.embeddingDimensions ? ` · ${payload.retrieval.embeddingDimensions}D` : ""}`
          : response.headers.get("X-Search-Strategy") || undefined,
      });
    } catch (searchError) {
      setResults([]);
      setSearchMeta({});
      setError(searchError instanceof Error ? searchError.message : "검색 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const runSearch = (event: FormEvent) => {
    event.preventDefault();
    void executeSearch(term);
  };

  const changeScope = (nextScope: SearchScope) => {
    setScope(nextScope);
    setType("전체");
    setResults([]);
    setSubmittedQuery("");
    setHasSearched(false);
    setError(null);
  };

  const quickTopics = scope === "internal"
    ? ["설비 예방보전 기준", "안전 작업 절차", "품질 이상 대응", "AI 플랫폼 운영 기준"]
    : [`${COMPANY_NAME} 베어링 제조 AI 최신 동향`, "산업안전 정책 변경", "에너지 시장 동향"];

  return (
    <div className="view-stack knowledge-base">
      <section className="knowledge-hero">
        <div className="knowledge-hero-heading">
          <div><span className="knowledge-eyebrow">ILJIN ENTERPRISE KNOWLEDGE DATA</span><h1 className="sr-only">Knowledge Data Base</h1><p>{scope === "internal" ? "질의를 재작성하고 Dense·BM25 결과를 RRF로 융합한 뒤 재정렬·근거 검증까지 수행합니다." : "사내 정보와 분리된 공개 웹에서 최신 외부 참고자료를 조사합니다."}</p></div>
          <div className="knowledge-policy"><span>ACL</span><strong>권한 기반 지식 접근</strong><small>{overview?.summary.department || "소속 부서"} Context 적용</small></div>
        </div>
        <div className="search-scope-switch search-scope-switch--hero" role="group" aria-label="지식 검색 범위">
          <button type="button" className={scope === "internal" ? "selected" : ""} aria-pressed={scope === "internal"} onClick={() => changeScope("internal")}>사내 지식</button>
          <button type="button" className={scope === "internet" ? "selected" : ""} aria-pressed={scope === "internet"} onClick={() => changeScope("internet")}>외부 참고자료</button>
        </div>
        {scope === "internal" && <div className="knowledge-stats" aria-label="접근 가능한 지식 현황">
          <div><span>지식 문서</span><strong>{overviewLoading ? "—" : (overview?.summary.totalDocuments || 0).toLocaleString("ko-KR")}</strong><small>색인 완료</small></div>
          <div><span>검색 단위</span><strong>{overviewLoading ? "—" : (overview?.summary.totalSegments || 0).toLocaleString("ko-KR")}</strong><small>검증된 Segment</small></div>
          <div><span>최근 갱신</span><strong>{overviewLoading ? "—" : (overview?.summary.recentUpdates || 0).toLocaleString("ko-KR")}</strong><small>최근 30일</small></div>
          <div><span>최종 업데이트</span><strong className="knowledge-date">{overview?.summary.latestUpdatedAt ? formatSearchDate(overview.summary.latestUpdatedAt) : "—"}</strong><small>최신 버전 우선</small></div>
        </div>}
        {scope === "internal" && <div className="knowledge-operational-strip" aria-label="Knowledge Data Base 운영 상태">
          <span><strong>{overview?.summary.indexedDocuments || 0}</strong> 색인 완료</span>
          <span><strong>{overview?.summary.processingDocuments || 0}</strong> 처리 중</span>
          <span><strong>{overview?.summary.failedDocuments || 0}</strong> 검토 필요</span>
          <span><strong>{overview?.summary.vectorCoverage || 0}%</strong> 벡터 커버리지</span>
          {overview?.summary.embeddingModel && <span className="knowledge-model">{overview.summary.embeddingModel} · {overview.summary.embeddingDimensions || "?"}D</span>}
        </div>}
        <form className="search-form knowledge-search-form" onSubmit={runSearch}>
          <label className="sr-only" htmlFor="search-term">지식 검색어</label>
          <input id="search-term" value={term} onChange={(event) => setTerm(event.target.value)} placeholder={scope === "internal" ? "규정, 매뉴얼, 보고서, 설비 지식을 질문하세요" : "최신 외부 자료를 검색하세요"} />
          <button className="button button-primary" type="submit" disabled={loading || term.trim().length < 2}>{loading ? "검색 중" : "지식 검색"}</button>
        </form>
        <div className="knowledge-quick-topics" aria-label="추천 검색어"><span>추천</span>{quickTopics.map((topic) => <button type="button" key={topic} onClick={() => void executeSearch(topic)}>{topic}</button>)}</div>
      </section>
      {overviewError && scope === "internal" && <div className="knowledge-load-error" role="alert">
        <span>{overviewError}</span>
        <button type="button" onClick={refreshOverview}>다시 시도</button>
      </div>}
      {scope === "internal" && <div className="knowledge-catalog-toolbar"><span>Knowledge Data Base 카탈로그</span><button className="knowledge-refresh-button" type="button" onClick={refreshOverview} disabled={overviewLoading}>새로고침</button></div>}
      {scope === "internal" && <section className="knowledge-catalog" aria-labelledby="recent-knowledge-title">
        <div className="knowledge-section-heading"><div><span className="section-kicker">LATEST KNOWLEDGE</span><h2 id="recent-knowledge-title">최근 업데이트 지식</h2><p>접근 가능한 최신 버전의 문서와 원문 상태를 보여줍니다.</p></div><div className="knowledge-category-summary">{(overview?.categories || []).slice(0, 4).map((category) => <span key={category.sourceType}>{category.label} {category.count}</span>)}</div></div>
        {overviewLoading ? <div className="knowledge-catalog-loading" role="status">지식 카탈로그를 불러오고 있습니다.</div> : overview?.recent.length ? <div className="knowledge-card-grid">{overview.recent.slice(0, 6).map((asset) => <article className="knowledge-card" key={asset.id}>
          <div className="knowledge-card-top"><span className="knowledge-file-mark">{asset.mime_type.includes("csv") ? "DATA" : asset.mime_type.includes("json") ? "JSON" : "DOC"}</span><span className={`knowledge-classification knowledge-${asset.classification}`}>{asset.classification === "confidential" ? "기밀" : asset.classification === "public" ? "공개" : "사내"}</span></div>
           <div className={`knowledge-status knowledge-status-${asset.status}`}>{knowledgeStatusLabel(asset.status)}</div><h3>{asset.title}</h3>
          <p>{asset.segment_count.toLocaleString("ko-KR")}개 검색 단위 · v{asset.version}</p>
           <p className="knowledge-embedding-meta">{asset.embedding_model ? `${asset.embedding_model} · ${asset.embedding_dimensions || "?"}D` : "임베딩 대기"}</p><dl><div><dt>최종 갱신</dt><dd>{formatSearchDate(asset.updated_at)}</dd></div><div><dt>범위</dt><dd>{asset.department_scope === "*" ? "전사" : asset.department_scope}</dd></div></dl>
          <div className="knowledge-card-actions"><button type="button" onClick={() => void executeSearch(asset.title, "internal")}>이 문서 검색</button><button type="button" onClick={() => onChat(`${asset.title} v${asset.version}의 최신 근거를 바탕으로 핵심 내용과 실무 적용 사항을 설명해줘.`, "internal")}>AI에게 질문</button>{asset.original_uploaded_at && <a href={`/api/v1/assets/${encodeURIComponent(asset.id)}/original`}>원문</a>}</div>
        </article>)}</div> : <div className="knowledge-catalog-loading">접근 가능한 색인 문서가 없습니다.</div>}
      </section>}
      {scope === "internal" && canUpload && <DocumentIngest onIndexed={(_document, indexedTitle) => { setTerm(indexedTitle); setOverviewLoading(true); setCatalogRefreshKey((key) => key + 1); }} />}
      <div className="search-layout">
        <aside className="filter-panel" aria-label="지식 필터">
          <h2>지식 필터</h2>
          <p className="filter-scope"><strong>{scope === "internal" ? "사내 지식" : "외부 참고자료"}</strong><span>{scope === "internal" ? "Tenant · 부서 · 문서등급 ACL 적용" : "공개 웹 출처 · 내부정보 전송 금지"}</span></p>
          {scope === "internal" && <>
            <fieldset><legend>콘텐츠 유형</legend>{["전체", "문서", "이미지", "영상"].map((item) => <label key={item}><input type="radio" name="content-type" checked={type === item} onChange={() => setType(item)} />{item}</label>)}</fieldset>
            <label className="filter-select">수집 소스<select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="">전체 소스</option>{(overview?.categories || []).map((category) => <option key={category.sourceType} value={category.sourceType}>{category.label} ({category.count})</option>)}</select></label>
            <label className="filter-select">수집 기간<select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}><option value="all">전체 기간</option><option value="7">최근 7일</option><option value="30">최근 30일</option><option value="365">최근 1년</option></select></label>
            <p className="filter-scope"><strong>부서</strong><span>로그인 사용자의 부서 ACL 자동 적용</span></p>
          </>}
          <p className="filter-note">{scope === "internal" ? "최신 접근 가능 버전만 검색하며, 근거 신뢰도가 부족하면 AI 답변 생성을 차단합니다." : "외부 참고자료에는 내부·기밀 정보를 입력하지 마세요. 상용 검색 API 미연결 시 최신 정보 범위가 제한됩니다."}</p>
        </aside>
        <section className="result-panel rag-result-panel" aria-label={scope === "internal" ? "사내 지식 검색 결과" : "외부 참고자료 검색 결과"}><RagResults results={visibleResults} query={submittedQuery} totalCount={visibleResults.length} elapsedMs={elapsedMs} traceId={searchMeta.traceId} retrievalLabel={searchMeta.retrievalLabel} accessLabel={scope === "internal" ? "최신 버전 · ACL 적용" : "공개 인터넷"} loading={loading} error={error} emptyTitle={hasSearched ? `${scope === "internal" ? type : "외부 자료"} 검색 결과가 없습니다.` : "지식 검색어를 입력해 근거를 찾아보세요."} emptyDescription={hasSearched ? "검색어나 필터를 변경해 다시 시도해 주세요." : scope === "internal" ? "검색 결과에서 최신 버전, 문서 위치, 인용 근거를 확인할 수 있습니다." : "외부 출처의 게시일과 원문 링크를 함께 확인할 수 있습니다."} onUseInChat={(result) => onChat(`${result.title}${result.sourceUrl ? ` (${result.sourceUrl})` : ""}의 최신 근거를 바탕으로 자세히 설명해줘.`, scope)} /></section>
      </div>
    </div>
  );
}

function ActivityView({ onNavigate, onOpenConversation }: { onNavigate: (view: View) => void; onOpenConversation: (id: string) => void }) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/v1/activity?limit=100", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { items?: ActivityItem[]; error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message || "활동 이력을 불러오지 못했습니다.");
        return payload.items || [];
      })
      .then((activityItems) => { if (active) setItems(activityItems); })
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : "활동 이력을 불러오지 못했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const openItem = (item: ActivityItem) => {
    if (item.target === "chat" && item.resourceId) onOpenConversation(item.resourceId);
    else onNavigate(item.target === "documents" ? "search" : item.target);
  };

  return <div className="view-stack activity-page">
    <div className="page-heading activity-page-heading"><div><span className="section-kicker">ACTIVITY</span><h1 className="sr-only">내 활동</h1><p>최근 대화, 검색, Agent 실행과 승인 이력을 한 곳에서 확인하세요.</p></div><a className="button button-secondary" href="/api/v1/activity?format=csv">활동 CSV 내보내기</a></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="panel table-wrap"><table><caption className="sr-only">최근 활동 목록</caption><thead><tr><th>유형</th><th>활동</th><th>일시</th><th>상태</th><th><span className="sr-only">작업</span></th></tr></thead><tbody>
      {!loading && items.length === 0 && <tr><td colSpan={5}>저장된 활동이 없습니다.</td></tr>}
      {items.map((item) => <tr key={item.id}><td><span className="table-type">{item.typeLabel}</span></td><td><strong>{item.title}</strong>{item.detail && <small className="table-subtext">{item.detail}</small>}</td><td>{new Date(item.createdAt).toLocaleString("ko-KR")}</td><td>{item.status}</td><td><button type="button" className="text-button" onClick={() => openItem(item)}>열기</button></td></tr>)}
    </tbody></table></section>
  </div>;
}

type AdminIssueTone = "danger" | "warning" | "neutral";

function AdminIssueSummary({ items, onSelect }: {
  items: Array<{ label: string; value: number; detail: string; tone: AdminIssueTone; section: AdminSection }>;
  onSelect: (section: AdminSection) => void;
}) {
  return (
    <section className="admin-issue-summary" aria-labelledby="admin-issue-summary-title">
      <div className="admin-issue-summary__heading">
        <div><span className="section-kicker">ACTION QUEUE</span><h2 id="admin-issue-summary-title">즉시 조치 요약</h2></div>
        <span>실시간 운영 데이터 기준</span>
      </div>
      <div className="admin-issue-summary__grid">
        {items.map((item) => (
          <button key={item.label} type="button" className={`admin-issue-card admin-issue-card--${item.tone}`} onClick={() => onSelect(item.section)}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

type AdminSection = "overview" | "system" | "access" | "management" | "knowledge";

type AdminOverviewData = {
  generatedAt: string;
  usage: {
    users: { total: number; approved: number; pending: number; active30d: number };
    conversations: { total: number; last30d: number };
    agentRuns24h: { total: number; completed: number; failed: number };
    llm24h: { total: number; totalTokens: number; averageLatencyMs: number | null };
    retrieval24h: { total: number; averageLatencyMs: number | null };
  };
  management: {
    assets: { total: number; indexed: number; segments: number };
    failedIndexJobs: number;
    pendingApprovals: number;
    openFeedback: number;
    enabledTools: number;
    enabledSchedules: number;
    openWorkItems: number;
    auditEvents7d: number;
  };
};

function AdminOverviewDashboard({
  overview,
  health,
  qualityGates,
  loading,
  onSelect,
}: {
  overview?: AdminOverviewData;
  health: { gateway?: { configured?: boolean }; rag?: { d1Configured?: boolean; r2Configured?: boolean; embeddingConfigured?: boolean; rerankConfigured?: boolean } };
  qualityGates: Array<{ passed: boolean }>;
  loading: boolean;
  onSelect: (section: AdminSection) => void;
}) {
  const services = [
    health.gateway?.configured,
    health.rag?.d1Configured,
    health.rag?.r2Configured,
    health.rag?.embeddingConfigured,
    health.rag?.rerankConfigured,
  ];
  const readyServices = services.filter(Boolean).length;
  const passedGates = qualityGates.filter((gate) => gate.passed).length;
  const value = (amount: number | null | undefined) => amount === null || amount === undefined ? "—" : amount.toLocaleString("ko-KR");
  const latency = (amount: number | null | undefined) => amount === null || amount === undefined ? "데이터 없음" : `${Math.round(amount).toLocaleString("ko-KR")}ms 평균`;
  const usage = overview?.usage;
  const management = overview?.management;
  const metricCards = [
    ["전체 사용자", value(usage?.users.total), usage ? `승인 ${value(usage.users.approved)}명` : "집계 대기"],
    ["최근 30일 활성 사용자", value(usage?.users.active30d), usage ? `승인 사용자 ${value(usage.users.approved)}명 기준` : "집계 대기"],
    ["최근 30일 대화", value(usage?.conversations.last30d), usage ? `전체 ${value(usage.conversations.total)}건` : "집계 대기"],
    ["최근 24시간 LLM 호출", value(usage?.llm24h.total), usage ? `${value(usage.llm24h.totalTokens)} tokens` : "집계 대기"],
  ];

  return (
    <section className="admin-overview-dashboard" aria-labelledby="admin-overview-title">
      <header className="admin-overview-dashboard__header">
        <div><span className="section-kicker">PLATFORM OVERVIEW</span><h2 id="admin-overview-title">전체 플랫폼 현황</h2><p>사용 현황과 운영·관리 상태를 한 화면에서 확인합니다.</p></div>
        <span className="admin-overview-dashboard__stamp">{loading ? "집계 중" : overview ? `기준 ${new Date(overview.generatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` : "데이터 없음"}</span>
      </header>
      <div className="admin-overview-dashboard__metrics">
        {metricCards.map(([label, metric, detail]) => <article key={label} className="admin-overview-dashboard__metric"><span>{label}</span><strong>{metric}</strong><small>{detail}</small></article>)}
      </div>
      <div className="admin-overview-dashboard__columns">
        <section className="admin-overview-dashboard__panel">
          <div className="panel-title"><div><span className="section-kicker">USAGE</span><h3>플랫폼 사용 현황</h3></div><span className="admin-overview-dashboard__period">24시간 / 30일</span></div>
          <div className="admin-overview-dashboard__rows">
            <div><span>Agent 실행</span><strong>{value(usage?.agentRuns24h.total)}</strong><small>완료 {value(usage?.agentRuns24h.completed)} · 실패 {value(usage?.agentRuns24h.failed)}</small></div>
            <div><span>RAG 검색</span><strong>{value(usage?.retrieval24h.total)}</strong><small>{latency(usage?.retrieval24h.averageLatencyMs)}</small></div>
            <div><span>LLM 평균 응답</span><strong>{latency(usage?.llm24h.averageLatencyMs)}</strong><small>{value(usage?.llm24h.totalTokens)} tokens 사용</small></div>
            <div><span>지식 자산</span><strong>{value(management?.assets.indexed)}</strong><small>Indexed / 전체 {value(management?.assets.total)} · {value(management?.assets.segments)} segments</small></div>
          </div>
        </section>
        <section className="admin-overview-dashboard__panel">
          <div className="panel-title"><div><span className="section-kicker">MANAGEMENT</span><h3>관리 현황</h3></div><span className="admin-overview-dashboard__period">실시간 집계</span></div>
          <div className="admin-overview-dashboard__rows">
            <button type="button" onClick={() => onSelect("access")}><span>가입 승인 대기</span><strong>{value(usage?.users.pending)}</strong><small>{usage?.users.pending ? "가입 신청 검토가 필요합니다" : "대기 신청 없음"}</small></button>
            <button type="button" onClick={() => onSelect("knowledge")}><span>인덱싱 실패</span><strong>{value(management?.failedIndexJobs)}</strong><small>{management?.failedIndexJobs ? "재처리가 필요합니다" : "실패 작업 없음"}</small></button>
            <button type="button" onClick={() => onSelect("management")}><span>Tool 승인 대기</span><strong>{value(management?.pendingApprovals)}</strong><small>{management?.pendingApprovals ? "승인 검토가 필요합니다" : "대기 승인 없음"}</small></button>
            <div><span>서비스·품질 준비도</span><strong>{readyServices}/5 · {passedGates}/{qualityGates.length || 0}</strong><small>연결 서비스 / 통과 Quality Gate</small></div>
          </div>
        </section>
      </div>
      <div className="admin-overview-dashboard__footer" aria-label="관리 리소스 요약">
        <span>활성 Tool {value(management?.enabledTools)}</span><span>예약 작업 {value(management?.enabledSchedules)}</span><span>진행 업무 {value(management?.openWorkItems)}</span><span>미해결 피드백 {value(management?.openFeedback)}</span><span>최근 7일 감사 이벤트 {value(management?.auditEvents7d)}</span>
      </div>
    </section>
  );
}

function AdminSectionNav({ activeSection, onSelect }: { activeSection: AdminSection; onSelect: (section: AdminSection) => void }) {
  const sections = [
    ["overview", "운영 개요"],
    ["system", "시스템 구조·모니터링"],
    ["access", "가입 승인"],
    ["management", "조직·권한 관리"],
    ["knowledge", "지식베이스"],
  ] as const;

  const goToSection = (section: AdminSection) => onSelect(section);

  return (
    <nav className="admin-section-nav" aria-label="관리자 운영 영역">
      {sections.map(([id, label], index) => (
        <button key={id} type="button" className={activeSection === id ? "active" : ""} aria-pressed={activeSection === id} onClick={() => goToSection(id)}>
          <span>{String(index + 1).padStart(2, "0")}</span>{label}
        </button>
      ))}
    </nav>
  );
}

function AdminView({ currentEmail }: { currentEmail: string }) {
  type AssetRow = {
    id: string;
    title: string;
    status: string;
    source_type: string;
    classification: string;
    segment_count: number;
    original_size?: number;
    original_etag?: string;
    original_uploaded_at?: string;
    embedding_model?: string;
    embedding_dimensions?: number;
    mime_type?: string;
    department_scope?: string;
    updated_at: string;
  };
  type AssetSort = "updated" | "title" | "segments";
  type JobRow = { id: string; asset_id?: string; title?: string; status: string; stage: string; error_code?: string; attempt_count: number; completed_at?: string };
  type Health = { gateway?: { configured?: boolean; model?: string }; rag?: { d1Configured?: boolean; r2Configured?: boolean; embeddingConfigured?: boolean; rerankConfigured?: boolean; embeddingModel?: string; rerankModel?: string; embeddingProvider?: string; rerankProvider?: string } };
  type QualityGate = { id: string; label: string; passed: boolean; value: number; unit: string; evidence: string };
  type Corporation = { id: string; name: string; status: string; departmentCount: number; memberCount: number };
  type Department = { id: string; corpId: string; name: string; status: string; path: string; depth: number };
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessUser[]>([]);
  const [corporations, setCorporations] = useState<Corporation[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { department: string; corpId: string; deptId: string; role: "user" | "manager" }>>({});
  const [reviewingEmail, setReviewingEmail] = useState("");
  const [health, setHealth] = useState<Health>({});
  const [overview, setOverview] = useState<AdminOverviewData>();
  const [qualityGates, setQualityGates] = useState<QualityGate[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [assetActionId, setAssetActionId] = useState("");
  const [jobActionId, setJobActionId] = useState("");
  const [assetQuery, setAssetQuery] = useState("");
  const [vectorQuery, setVectorQuery] = useState("");
  const [assetStatus, setAssetStatus] = useState("all");
  const [assetSort, setAssetSort] = useState<AssetSort>("updated");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date>();
  const [activeSection, setActiveSection] = useState<AdminSection>("overview");
  const [autoRefresh, setAutoRefresh] = useState(false);

  const loadAdminData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    const checkedJson = async <T,>(url: string) => {
      const response = await fetch(url, { signal });
      const payload = await response.json() as T & { error?: { message?: string } };
      if (!response.ok && url !== "/api/health") throw new Error(payload.error?.message || `${url} 요청 실패`);
      return payload;
    };
    try {
      const [assetData, jobData, accessData, healthData, qualityData, overviewData, organizationData] = await Promise.all([
        checkedJson<{ assets?: AssetRow[] }>("/api/admin/assets?limit=100"),
        checkedJson<{ jobs?: JobRow[] }>("/api/admin/index-jobs"),
        checkedJson<{ items?: AccessUser[] }>("/api/admin/access-requests"),
        checkedJson<Health>("/api/health"),
        checkedJson<{ gates?: QualityGate[] }>("/api/admin/quality-gates"),
        checkedJson<AdminOverviewData>("/api/admin/overview"),
        checkedJson<{ corporations?: Corporation[]; departments?: Department[] }>("/api/admin/organization"),
      ]);
      setAssets(assetData.assets || []);
      setJobs(jobData.jobs || []);
      setAccessRequests(accessData.items || []);
      setHealth(healthData);
      setOverview(overviewData);
      setQualityGates(qualityData.gates || []);
      setCorporations(organizationData.corporations || []);
      setDepartments(organizationData.departments || []);
      setLoadError("");
      setLastSyncedAt(new Date());
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setLoadError(error instanceof Error ? error.message : "운영 데이터를 불러오지 못했습니다.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadAdminData(controller.signal));
    return () => controller.abort();
  }, [loadAdminData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = window.setInterval(() => void loadAdminData(), 60_000);
    return () => window.clearInterval(interval);
  }, [autoRefresh, loadAdminData]);

  const manageAsset = async (asset: AssetRow, action: "reindex" | "delete") => {
    if (action === "delete" && !window.confirm(`'${asset.title}' 문서와 파생 인덱스를 삭제할까요?`)) return;
    setAssetActionId(asset.id);
    setLoadError("");
    try {
      const response = await fetch(
        action === "reindex"
          ? `/api/v1/assets/${encodeURIComponent(asset.id)}/reindex`
          : `/api/v1/assets/${encodeURIComponent(asset.id)}`,
        { method: action === "reindex" ? "POST" : "DELETE" },
      );
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "문서 작업을 처리하지 못했습니다.");
      await loadAdminData();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "문서 작업을 처리하지 못했습니다.");
    } finally {
      setAssetActionId("");
    }
  };

  const reviewAccess = async (user: AccessUser, decision: "approved" | "rejected") => {
    const draft = reviewDrafts[user.email] || {
      department: user.department,
      corpId: user.corpId || "",
      deptId: user.deptId || "",
      role: user.role === "manager" ? "manager" as const : "user" as const,
    };
    setReviewingEmail(user.email);
    setLoadError("");
    try {
      const response = await fetch("/api/admin/access-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          decision,
          department: draft.department,
          corpId: draft.corpId || null,
          deptId: draft.deptId || null,
          role: draft.role,
          reason: decision === "rejected" ? "관리자 검토 결과 가입 신청이 반려되었습니다." : undefined,
        }),
      });
      const payload = await response.json() as { user?: AccessUser; error?: { message?: string } };
      if (!response.ok || !payload.user) throw new Error(payload.error?.message || "가입 신청을 처리하지 못했습니다.");
      setAccessRequests((items) => items.map((item) => item.email === user.email ? payload.user! : item));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "가입 신청을 처리하지 못했습니다.");
    } finally {
      setReviewingEmail("");
    }
  };

  const retryJob = async (job: JobRow) => {
    setJobActionId(job.id);
    setLoadError("");
    try {
      const response = await fetch(`/api/admin/index-jobs/${encodeURIComponent(job.id)}/retry`, { method: "POST" });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "인덱싱 작업을 재시도하지 못했습니다.");
      await loadAdminData();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "인덱싱 작업을 재시도하지 못했습니다.");
    } finally {
      setJobActionId("");
    }
  };

  const completedJobs = jobs.filter((job) => job.status === "completed").length;
  const failedJobs = jobs.filter((job) => job.status === "failed").length;
  const pendingAccess = accessRequests.filter((user) => user.status === "pending").length;
  const segmentCount = assets.reduce((sum, asset) => sum + Number(asset.segment_count || 0), 0);
  const assetStatusLabel: Record<string, string> = { indexed: "색인 완료", queued: "색인 대기", processing: "처리 중", failed: "색인 오류" };
  const classificationLabel: Record<string, string> = { public: "공개", internal: "사내", confidential: "기밀" };
  const sourceLabel: Record<string, string> = { upload: "직접 업로드", image: "이미지", "requirements-seed": "기본 문서", "file-link": "파일 링크", "r2-folder": "R2 폴더" };
  const vectorDbFiles = assets.filter((asset) => {
    const query = vectorQuery.trim().toLocaleLowerCase("ko-KR");
    return asset.status === "indexed"
      && Boolean(asset.embedding_model && asset.embedding_dimensions && asset.segment_count > 0)
      && (!query || `${asset.title} ${asset.source_type} ${asset.embedding_model}`.toLocaleLowerCase("ko-KR").includes(query));
  });
  const formatAssetDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "시간 정보 없음" : date.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };
  const formatAssetSize = (size?: number) => {
    if (!size) return "원문 크기 없음";
    if (size < 1024 * 1024) return `${Math.max(1, Math.ceil(size / 1024)).toLocaleString("ko-KR")} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };
  const filteredAssets = assets
    .filter((asset) => {
      const query = assetQuery.trim().toLocaleLowerCase("ko-KR");
      if (query && !`${asset.title} ${asset.source_type} ${asset.classification}`.toLocaleLowerCase("ko-KR").includes(query)) return false;
      return assetStatus === "all" || asset.status === assetStatus;
    })
    .sort((left, right) => {
      if (assetSort === "title") return left.title.localeCompare(right.title, "ko-KR");
      if (assetSort === "segments") return Number(right.segment_count || 0) - Number(left.segment_count || 0);
      return Date.parse(right.updated_at) - Date.parse(left.updated_at);
    });
  const selectSection = (section: AdminSection) => {
    setActiveSection(section);
  };
  const services = [
    ["LLM Gateway", health.gateway?.configured, health.gateway?.model || "gemma-4-31b"],
    ["Metadata Database", health.rag?.d1Configured, `${assets.length} assets`],
    ["Object Storage", health.rag?.r2Configured, "원문 저장"],
    ["Embedding", health.rag?.embeddingConfigured, `${health.rag?.embeddingProvider || "cloudflare"} · ${health.rag?.embeddingModel || "@cf/baai/bge-m3"}`],
    ["Reranker", health.rag?.rerankConfigured, `${health.rag?.rerankProvider || "cloudflare"} · ${health.rag?.rerankModel || "@cf/baai/bge-reranker-base"}`],
  ] as const;
  const issueItems = [
    { label: "가입 승인 대기", value: pendingAccess, detail: pendingAccess ? "가입 신청 검토 필요" : "대기 없음", tone: pendingAccess ? "warning" : "neutral", section: "access" },
    { label: "인덱싱 실패", value: failedJobs, detail: failedJobs ? "재시도 또는 원인 확인 필요" : "실패 작업 없음", tone: failedJobs ? "danger" : "neutral", section: "knowledge" },
    { label: "서비스 미설정", value: services.filter(([, ready]) => !ready).length, detail: services.some(([, ready]) => !ready) ? "연결 상태 확인 필요" : "모든 서비스 연결됨", tone: services.some(([, ready]) => !ready) ? "danger" : "neutral", section: "overview" },
    { label: "품질 게이트 미통과", value: qualityGates.filter((gate) => !gate.passed).length, detail: qualityGates.some((gate) => !gate.passed) ? "릴리스 승인 전 확인 필요" : "모든 게이트 통과", tone: qualityGates.some((gate) => !gate.passed) ? "warning" : "neutral", section: "knowledge" },
  ] as Array<{ label: string; value: number; detail: string; tone: AdminIssueTone; section: AdminSection }>;

  return (
    <div className="view-stack admin-view">
      <div className="page-heading admin-page-heading"><div><span className="section-kicker">ADMINISTRATION</span><h1 className="sr-only">관리자 콘솔</h1><p>전체 플랫폼 사용 현황과 운영·권한·데이터 관리 상태를 확인합니다.</p></div></div>
      <AdminSectionNav activeSection={activeSection} onSelect={selectSection} />
      <div className="admin-tab-screen" id="admin-tab-screen" tabIndex={-1}>
      {activeSection === "overview" && <>
      <div className="page-heading"><div><h1 className="sr-only">RAG 운영 Dashboard</h1><p>Database·Storage·AI 모델의 실제 인덱싱 상태를 표시합니다.</p></div><div className="admin-actions"><span className="live-state" role="status" aria-live="polite" title={loadError || undefined}><span className={`status-dot ${loading ? "status-dot-checking" : loadError ? "status-dot-offline" : "status-dot-ready"}`} /> {loading ? "API 확인 중" : loadError ? "API 응답 오류" : "API 응답 완료"}</span><button className="button button-secondary" type="button" onClick={() => void loadAdminData()} disabled={loading}>{loading ? "동기화 중" : "데이터 새로고침"}</button></div></div>
      {lastSyncedAt && <p className="admin-sync-note" role="status">마지막 동기화 · {lastSyncedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</p>}
       <div className="admin-sync-toolbar">
         <label className="admin-auto-refresh-toggle"><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} /> Auto-refresh every 60s</label>
       </div>
       {loadError && <p className="form-error admin-load-error" role="alert">{loadError}</p>}
       <section className="metric-grid admin-legacy-metrics">
        {[["인덱싱 Asset", String(assets.filter((asset) => asset.status === "indexed").length), "Database 실데이터"],["검색 Segment", String(segmentCount), "Dense Vector 포함"],["승인 대기", String(pendingAccess), "사용자 접근 요청"],["완료 Index Job", String(completedJobs), failedJobs ? `실패 ${failedJobs}` : "실패 0"]].map(([label, value, trend]) => <article className="metric-card" key={label}><span>{label}</span><strong>{value}</strong><small>{trend}</small></article>)}
      </section>
      <AdminOverviewDashboard overview={overview} health={health} qualityGates={qualityGates} loading={loading} onSelect={selectSection} />
      <AdminIssueSummary items={issueItems} onSelect={selectSection} />
      <PlatformOperationsConsole />
      </>}
      {activeSection === "system" && <SystemArchitectureMonitor />}
      {activeSection === "access" && <section className="panel access-review-panel" id="admin-access">
        <div className="panel-title"><div><span className="section-kicker">REGISTRATION APPROVAL</span><h2>가입 승인</h2></div><span className={`status-pill ${pendingAccess ? "status-승인-대기" : "status-승인-완료"}`}>{pendingAccess ? `${pendingAccess}건 대기` : "대기 없음"}</span></div>
        <p className="panel-description">가입 신청자의 법인·부서·사유·역할을 조직 마스터 기준으로 검토하고 승인합니다.</p>
        <div className="table-wrap"><table><caption className="sr-only">가입 승인 신청 목록</caption><thead><tr><th>사용자</th><th>조직 배정</th><th>역할</th><th>상태</th><th>승인 작업</th></tr></thead><tbody>
          {accessRequests.length === 0 && <tr><td colSpan={5}>가입 신청이 없습니다.</td></tr>}
          {accessRequests.map((user) => {
            const draft = reviewDrafts[user.email] || { department: user.department, corpId: user.corpId || "", deptId: user.deptId || "", role: user.role === "manager" ? "manager" as const : "user" as const };
            const busy = reviewingEmail === user.email;
            return <tr key={user.email}><td><strong>{user.displayName}</strong><small className="table-subtext">{user.email}</small>{user.applicationNote && <small className="table-subtext application-note">신청 사유 · {user.applicationNote}</small>}</td><td><div className="approval-org-fields"><select className="table-select" value={draft.corpId} onChange={(event) => setReviewDrafts((items) => ({ ...items, [user.email]: { ...draft, corpId: event.target.value, deptId: "", department: "" } }))} aria-label={`${user.displayName} 법인`}><option value="">법인 선택</option>{corporations.filter((corporation) => corporation.status !== "archived").map((corporation) => <option key={corporation.id} value={corporation.id}>{corporation.name}</option>)}</select><select className="table-select" value={draft.deptId} onChange={(event) => { const department = departments.find((item) => item.id === event.target.value); setReviewDrafts((items) => ({ ...items, [user.email]: { ...draft, corpId: department?.corpId || draft.corpId, deptId: event.target.value, department: department?.name || "" } })); }} aria-label={`${user.displayName} 부서`} disabled={!draft.corpId}><option value="">부서 선택</option>{departments.filter((department) => department.status !== "archived" && department.corpId === draft.corpId).map((department) => <option key={department.id} value={department.id}>{department.path}</option>)}</select></div></td><td><select className="table-select" value={draft.role} onChange={(event) => setReviewDrafts((items) => ({ ...items, [user.email]: { ...draft, role: event.target.value as "user" | "manager" } }))} aria-label={`${user.displayName} 역할`}><option value="user">사용자</option><option value="manager">매니저</option></select></td><td><span className={`status-pill status-access-${user.status}`}>{user.status === "pending" ? "승인 대기" : user.status === "approved" ? "승인 완료" : "반려"}</span></td><td><div className="review-actions"><button className="button button-primary" type="button" disabled={busy || !draft.deptId} onClick={() => reviewAccess(user, "approved")}>{busy ? "처리 중" : "가입 승인"}</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => reviewAccess(user, "rejected")}>반려</button></div></td></tr>;
          })}
        </tbody></table></div>
      </section>}
      {activeSection === "management" && <div className="admin-management-tab" id="admin-management"><div id="admin-organization"><OrgConsole currentEmail={currentEmail} /></div><div id="admin-governance"><AdminGovernance currentEmail={currentEmail} /></div></div>}
      {activeSection === "knowledge" && <>
      <div id="admin-ingestion"><IngestionSources /><InternetSearchOperations /></div>
      <div className="vector-db-search"><label htmlFor="vector-db-search-input">Vector DB 파일 검색</label><input id="vector-db-search-input" className="table-input" value={vectorQuery} onChange={(event) => setVectorQuery(event.target.value)} placeholder="파일명·출처·모델 검색" /></div>
      <div className="admin-grid" id="admin-assets">
        <section className="panel"><div className="panel-title"><div><span className="section-kicker">SERVICE HEALTH</span><h2>RAG 구성요소</h2></div><span className={`status-pill ${services.every(([, ready]) => ready) ? "status-완료" : "status-부분-완료"}`}>{services.every(([, ready]) => ready) ? "준비" : "확인 필요"}</span></div><div className="service-list">{services.map(([name, ready, detail]) => <div key={name}><span className={`status-dot ${ready ? "" : "status-dot-warning"}`} /><strong>{name}</strong><span>{ready ? "연결" : "미설정"}</span><small>{detail}</small></div>)}</div></section>
        <section className="panel"><div className="panel-title"><div><span className="section-kicker">QUALITY GATE</span><h2>실시간 검증 상태</h2></div><span className={`status-pill ${qualityGates.length > 0 && qualityGates.every((gate) => gate.passed) ? "status-완료" : "status-부분-완료"}`}>{qualityGates.filter((gate) => gate.passed).length}/{qualityGates.length || 6} 통과</span></div><div className="quality-list">{qualityGates.map((gate) => <div key={gate.id}><div><strong>{gate.label}</strong><span>{gate.evidence}</span></div><progress value={gate.passed ? 100 : 0} max="100">{gate.passed ? "100%" : "0%"}</progress><small>{gate.value} {gate.unit}</small></div>)}</div></section>
         <section className="panel knowledge-assets-panel" aria-labelledby="vector-db-files-title"><div className="panel-title knowledge-assets-panel__heading"><div><span className="section-kicker">VECTOR DB FILES</span><h2 id="vector-db-files-title">Vector DB 파일 목록</h2><p className="panel-description">Cloudflare Vectorize에 세그먼트가 저장된 문서만 표시합니다. 재색인과 삭제는 원본·메타데이터·벡터를 함께 갱신합니다.</p></div><span className="status-pill status-완료">{vectorDbFiles.length}건</span></div><div className="knowledge-assets-list" aria-live="polite">{vectorDbFiles.map((asset) => <article key={asset.id} className="knowledge-asset-card knowledge-asset-card--indexed"><div className="knowledge-asset-card__main"><div className="knowledge-asset-card__title"><div><h3>{asset.title}</h3><p>{sourceLabel[asset.source_type] || asset.source_type} · {asset.mime_type || "형식 정보 없음"}</p></div><span className="knowledge-asset-status">Vector DB</span></div><dl className="knowledge-asset-meta"><div><dt>벡터</dt><dd>{Number(asset.segment_count || 0).toLocaleString("ko-KR")}개</dd></div><div><dt>차원</dt><dd>{asset.embedding_dimensions}D</dd></div><div><dt>모델</dt><dd>{asset.embedding_model}</dd></div><div><dt>최종 변경</dt><dd>{formatAssetDate(asset.updated_at)}</dd></div></dl></div><div className="knowledge-asset-card__actions">{asset.original_uploaded_at && <a className="text-button" href={`/api/v1/assets/${encodeURIComponent(asset.id)}/original`}>원문 열기</a>}<button type="button" className="text-button" disabled={assetActionId === asset.id} onClick={() => void manageAsset(asset, "reindex")}>{assetActionId === asset.id ? "처리 중" : "재색인"}</button><button type="button" className="text-button text-button-danger" disabled={assetActionId === asset.id} onClick={() => void manageAsset(asset, "delete")}>삭제</button></div></article>)}{!vectorDbFiles.length && <div className="knowledge-assets-empty"><strong>Vector DB에 저장된 문서가 없습니다.</strong><span>문서를 등록하고 임베딩이 완료되면 이 목록에 표시됩니다.</span></div>}</div><p className="knowledge-assets-panel__count">{vectorDbFiles.length}건 표시</p></section>
         <section className="panel knowledge-assets-panel" aria-labelledby="knowledge-assets-title">
           <div className="panel-title knowledge-assets-panel__heading"><div><span className="section-kicker">KNOWLEDGE ASSETS</span><h2 id="knowledge-assets-title">문서 자산 현황</h2><p className="panel-description">문서의 색인 상태와 접근 범위, 최신 변경 정보를 확인합니다.</p></div><div className="admin-table-tools"><input className="table-input" value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} placeholder="제목·출처·등급 검색" aria-label="문서 자산 검색" /><select className="table-select" value={assetSort} onChange={(event) => setAssetSort(event.target.value as AssetSort)} aria-label="문서 정렬"><option value="updated">최근 변경순</option><option value="title">제목순</option><option value="segments">세그먼트 많은 순</option></select></div></div>
           <div className="asset-status-filters" role="group" aria-label="문서 상태 빠른 필터">{(["all", "indexed", "queued", "processing", "failed"] as const).map((status) => { const count = status === "all" ? assets.length : assets.filter((asset) => asset.status === status).length; if (status !== "all" && count === 0) return null; return <button key={status} type="button" className={assetStatus === status ? "active" : ""} aria-pressed={assetStatus === status} onClick={() => setAssetStatus(status)}><span>{status === "all" ? "전체" : assetStatusLabel[status]}</span><strong>{count}</strong></button>; })}</div>
           <div className="knowledge-assets-list" aria-live="polite">{filteredAssets.map((asset) => <article key={asset.id} className={`knowledge-asset-card knowledge-asset-card--${asset.status}`}><div className="knowledge-asset-card__main"><div className="knowledge-asset-card__title"><div><h3>{asset.title}</h3><p>{sourceLabel[asset.source_type] || asset.source_type} · {asset.mime_type || "형식 정보 없음"}</p></div><span className="knowledge-asset-status">{assetStatusLabel[asset.status] || asset.status}</span></div><dl className="knowledge-asset-meta"><div><dt>접근 등급</dt><dd>{classificationLabel[asset.classification] || asset.classification}</dd></div><div><dt>대상 부서</dt><dd>{asset.department_scope || "전체"}</dd></div><div><dt>색인 단위</dt><dd>{Number(asset.segment_count || 0).toLocaleString("ko-KR")} segments</dd></div><div><dt>최종 변경</dt><dd>{formatAssetDate(asset.updated_at)}</dd></div></dl><div className="knowledge-asset-detail"><span>벡터 {asset.embedding_dimensions ? `${asset.embedding_dimensions}D` : "미생성"}</span><span>{asset.embedding_model || "임베딩 모델 미생성"}</span><span>{formatAssetSize(asset.original_size)}</span></div></div><div className="knowledge-asset-card__actions">{asset.original_uploaded_at && <a className="text-button" href={`/api/v1/assets/${encodeURIComponent(asset.id)}/original`}>원문 열기</a>}<button type="button" className="text-button" disabled={assetActionId === asset.id} onClick={() => void manageAsset(asset, "reindex")}>{assetActionId === asset.id ? "처리 중" : "재색인"}</button><button type="button" className="text-button text-button-danger" disabled={assetActionId === asset.id} onClick={() => void manageAsset(asset, "delete")}>삭제</button></div></article>)}{!filteredAssets.length && <div className="knowledge-assets-empty"><strong>조건에 맞는 문서가 없습니다.</strong><span>검색어 또는 상태 필터를 조정해 보세요.</span></div>}</div>
           <p className="knowledge-assets-panel__count">목록은 10개 높이까지 표시되며, 추가 항목은 내부에서 스크롤됩니다.</p>
         </section>
         <section className="panel table-wrap"><div className="panel-title"><div><span className="section-kicker">INDEX JOBS</span><h2>최근 인덱싱 작업</h2></div><span>{failedJobs ? `실패 ${failedJobs}` : "정상"}</span></div><table><caption className="sr-only">최근 인덱싱 작업</caption><thead><tr><th>문서</th><th>단계</th><th>상태</th><th>시도</th><th>작업</th></tr></thead><tbody>{jobs.slice(0, 6).map((job) => <tr key={job.id}><td><strong>{job.title || job.id}</strong>{job.error_code && <small className="table-subtext">오류 코드 · {job.error_code}</small>}</td><td>{job.stage}</td><td>{job.status}</td><td>{job.attempt_count}</td><td>{job.status === "failed" ? <button type="button" className="text-button" disabled={jobActionId === job.id} onClick={() => void retryJob(job)}>{jobActionId === job.id ? "재시도 중" : "재시도"}</button> : "—"}</td></tr>)}{!jobs.length && <tr><td colSpan={5}>인덱싱 작업이 없습니다.</td></tr>}</tbody></table></section>
       </div>
       <RequirementsChecklist />
       </>}
       {activeSection === "overview" && <div id="admin-control"><AiControlTower currentEmail={currentEmail} /></div>}
      </div>
    </div>
  );
}

interface ScheduledTaskItem {
  id: string;
  prompt: string;
  cron_expression: string;
  next_run_at: string;
  last_run_at: string | null;
  enabled: boolean;
  last_result: string | null;
}

type ScheduleFilter = "all" | "enabled" | "paused";

const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];
const MONTHS_KO = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

function ScheduleView() {
  const [tasks, setTasks] = useState<ScheduledTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [calendarMonth, setCalendarMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");
  const [newScheduleType, setNewScheduleType] = useState<"daily" | "weekly" | "monthly">("daily");
  const [newHour, setNewHour] = useState(9);
  const [newMinute, setNewMinute] = useState(0);
  const [newWeekday, setNewWeekday] = useState(1);
  const [newMonthDay, setNewMonthDay] = useState(1);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<ScheduleFilter>("all");
  const [error, setError] = useState("");
  const [actionTaskId, setActionTaskId] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/v1/scheduled-tasks", { headers: { Accept: "application/json" } });
      const data = await res.json() as { items?: ScheduledTaskItem[]; error?: { message?: string } };
      if (!res.ok) throw new Error(data.error?.message || "스케쥴을 불러오지 못했습니다.");
      setTasks(data.items || []);
    } catch (loadError) {
      setTasks([]);
      setError(loadError instanceof Error ? loadError.message : "스케쥴을 불러오지 못했습니다.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let ignore = false;
    fetch("/api/v1/scheduled-tasks", { headers: { Accept: "application/json" } })
      .then(async (res) => {
        const data = await res.json() as { items?: ScheduledTaskItem[]; error?: { message?: string } };
        if (!res.ok) throw new Error(data.error?.message || "스케쥴을 불러오지 못했습니다.");
        if (!ignore) setTasks(data.items || []);
      })
      .catch((loadError) => {
        if (!ignore) {
          setTasks([]);
          setError(loadError instanceof Error ? loadError.message : "스케쥴을 불러오지 못했습니다.");
        }
      })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, []);

  const cronFromForm = (): string => {
    if (newScheduleType === "daily") return `${newMinute} ${newHour} * * *`;
    if (newScheduleType === "weekly") return `${newMinute} ${newHour} * * ${newWeekday}`;
    return `${newMinute} ${newHour} ${newMonthDay} * *`;
  };

  const handleCreate = async () => {
    if (!newPrompt.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/v1/scheduled-tasks", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ prompt: newPrompt.trim(), cron: cronFromForm() }),
      });
      const data = await res.json() as { error?: { message?: string } };
      if (!res.ok) throw new Error(data.error?.message || "예약 작업을 생성하지 못했습니다.");
      setNewPrompt(""); setShowCreateModal(false); void loadTasks();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "예약 작업을 생성하지 못했습니다.");
    }
    setCreating(false);
  };

  const handleToggle = async (taskId: string, enabled: boolean) => {
    setActionTaskId(taskId);
    setError("");
    try {
      const res = await fetch("/api/v1/scheduled-tasks", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, enabled: !enabled }),
      });
      if (!res.ok) throw new Error("예약 작업 상태를 변경하지 못했습니다.");
      await loadTasks();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "예약 작업 상태를 변경하지 못했습니다.");
    } finally {
      setActionTaskId(null);
    }
  };

  const handleDelete = async (taskId: string) => {
    if (!window.confirm("이 예약 작업을 삭제할까요?")) return;
    setActionTaskId(taskId);
    setError("");
    try {
      const res = await fetch(`/api/v1/scheduled-tasks?id=${encodeURIComponent(taskId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("예약 작업을 삭제하지 못했습니다.");
      await loadTasks();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "예약 작업을 삭제하지 못했습니다.");
    } finally {
      setActionTaskId(null);
    }
  };

  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startWeekday = firstDay.getDay();
    const totalDays = lastDay.getDate();
    const days: Array<{ date: Date | null; day: number }> = [];
    for (let i = 0; i < startWeekday; i++) days.push({ date: null, day: 0 });
    for (let d = 1; d <= totalDays; d++) days.push({ date: new Date(year, month, d), day: d });
    return days;
  }, [calendarMonth]);

  const tasksOnDate = (date: Date): ScheduledTaskItem[] => {
    return tasks.filter((task) => {
      if (!task.enabled) return false;
      const next = new Date(task.next_run_at);
      if (next.getFullYear() !== date.getFullYear() || next.getMonth() !== date.getMonth() || next.getDate() !== date.getDate()) return false;
      return true;
    });
  };

  const today = new Date();
  const isToday = (d: Date) => d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  const isSelected = (d: Date) => selectedDate && d.getFullYear() === selectedDate.getFullYear() && d.getMonth() === selectedDate.getMonth() && d.getDate() === selectedDate.getDate();
  const selectedTasks = selectedDate ? tasksOnDate(selectedDate) : [];
  const filteredTasks = tasks.filter((task) => filter === "all" || (filter === "enabled" ? task.enabled : !task.enabled));
  const upcomingTasks = filteredTasks.slice().sort((a, b) => new Date(a.next_run_at).getTime() - new Date(b.next_run_at).getTime()).slice(0, 10);
  const activeCount = tasks.filter((task) => task.enabled).length;
  const pausedCount = tasks.length - activeCount;

  return (
    <div className="view-stack schedule-view">
      <div className="page-heading schedule-header">
        <div>
          <span className="section-kicker">SCHEDULE</span>
          <h1 className="sr-only">스케줄 관리</h1>
          <p className="schedule-subtitle">반복 작업의 다음 실행 시각과 최근 결과를 한 곳에서 확인하세요.</p>
        </div>
        <button type="button" className="schedule-create-btn" onClick={() => setShowCreateModal(true)}>+ 새 예약 작업</button>
      </div>

      {error && <div className="schedule-alert" role="alert">{error}<button type="button" onClick={() => setError("")}>닫기</button></div>}

      <section className="schedule-summary" aria-label="스케줄 요약">
        <article><span>전체 일정</span><strong>{tasks.length}</strong><small>등록된 예약 작업</small></article>
        <article><span>활성 일정</span><strong>{activeCount}</strong><small>다음 실행 예정</small></article>
        <article><span>일시정지</span><strong>{pausedCount}</strong><small>실행하지 않음</small></article>
        <article><span>다음 실행</span><strong>{activeCount ? new Date(tasks.filter((task) => task.enabled).sort((a, b) => new Date(a.next_run_at).getTime() - new Date(b.next_run_at).getTime())[0].next_run_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }) : "—"}</strong><small>{activeCount ? "가장 가까운 실행일" : "활성 일정 없음"}</small></article>
      </section>

      <div className="schedule-grid">
        <section className="schedule-calendar-panel">
          <div className="calendar-nav">
            <button type="button" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} aria-label="이전 달">이전</button>
            <div><strong>{calendarMonth.getFullYear()}년 {MONTHS_KO[calendarMonth.getMonth()]}</strong><button type="button" className="calendar-today-btn" onClick={() => { const d = new Date(); setCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSelectedDate(d); }}>오늘</button></div>
            <button type="button" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} aria-label="다음 달">다음</button>
          </div>
          <div className="calendar-grid">
            {WEEKDAYS_KO.map((wd) => <div key={wd} className="calendar-weekday">{wd}</div>)}
            {calendarDays.map((entry, i) => {
              if (!entry.date) return <div key={i} className="calendar-day empty" />;
              const dayTasks = tasksOnDate(entry.date);
              const hasTasks = dayTasks.length > 0;
              return (
                <button
                  key={i}
                  type="button"
                  className={`calendar-day ${isToday(entry.date) ? "today" : ""} ${isSelected(entry.date) ? "selected" : ""} ${hasTasks ? "has-tasks" : ""}`}
                  onClick={() => setSelectedDate(entry.date)}
                >
                  <span className="calendar-day-num">{entry.day}</span>
                  {hasTasks && <span className="calendar-dot" />}
                  {hasTasks && <span className="calendar-day-count">{dayTasks.length}</span>}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="schedule-side-panel">
          <div className="schedule-panel-heading">
            <div>
              <span className="section-kicker">TASKS</span>
              <h2>{selectedDate ? "선택한 날짜" : "예정된 작업"}</h2>
            </div>
            {!selectedDate && <span className="schedule-count">{upcomingTasks.length}개 표시</span>}
          </div>
          {!selectedDate && <div className="schedule-filters" role="group" aria-label="작업 필터">
            {([["all", "전체"], ["enabled", "활성"], ["paused", "일시정지"]] as const).map(([value, label]) => <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}
          </div>}
          {selectedDate ? (
            <div className="schedule-day-detail">
              <p className="schedule-selected-date">{selectedDate.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}</p>
              {selectedTasks.length === 0 ? <p className="empty-state">예약된 작업이 없습니다.</p> : selectedTasks.map((task) => (
                <div key={task.id} className="schedule-task-card">
                  <div className="schedule-task-time">{new Date(task.next_run_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</div>
                  <div className="schedule-task-body"><strong>{task.prompt}</strong><small>반복: {task.cron_expression}</small><small>{task.last_run_at ? `최근 실행 ${new Date(task.last_run_at).toLocaleString("ko-KR")}` : "아직 실행되지 않음"}</small></div>
                  <div className="schedule-task-actions"><button type="button" disabled={actionTaskId === task.id} onClick={() => void handleToggle(task.id, task.enabled)}>{actionTaskId === task.id ? "처리 중" : "일시정지"}</button><button type="button" disabled={actionTaskId === task.id} onClick={() => void handleDelete(task.id)}>삭제</button></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="schedule-upcoming">
              {loading ? <p className="empty-state">불러오는 중...</p> : upcomingTasks.length === 0 ? <p className="empty-state">예약된 작업이 없습니다.</p> : upcomingTasks.map((task) => (
                <div key={task.id} className={`schedule-task-card ${task.enabled ? "" : "disabled"}`}>
                  <div className="schedule-task-time">{new Date(task.next_run_at).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                  <div className="schedule-task-body">
                    <strong>{task.prompt}</strong>
                    <small>반복: {task.cron_expression} · {task.enabled ? "활성" : "일시정지"}</small>
                    {task.last_result && <details className="schedule-task-result"><summary>최근 실행 결과</summary><p>{task.last_result.slice(0, 500)}</p></details>}
                  </div>
                  <div className="schedule-task-actions">
                    <button type="button" disabled={actionTaskId === task.id} onClick={() => void handleToggle(task.id, task.enabled)} aria-label={task.enabled ? "일시정지" : "활성화"}>{actionTaskId === task.id ? "처리 중" : task.enabled ? "일시정지" : "활성화"}</button>
                    <button type="button" disabled={actionTaskId === task.id} onClick={() => void handleDelete(task.id)} aria-label="삭제">삭제</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      <SchedulePlanningBoard />

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content schedule-modal" onClick={(e) => e.stopPropagation()}>
            <h2>새 예약 작업</h2>
            <label className="form-label">실행할 작업 (프롬프트)<textarea value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} placeholder="예: 지난주 불량률 분석 리포트를 작성해줘" rows={3} /></label>
            <div className="form-row schedule-time-row">
              <label className="form-label">반복 주기<select value={newScheduleType} onChange={(e) => setNewScheduleType(e.target.value as "daily" | "weekly" | "monthly")}>
                <option value="daily">매일</option><option value="weekly">매주</option><option value="monthly">매월</option>
              </select></label>
              <label className="form-label"><span>실행 시간</span><span className="schedule-time-selects"><select value={newHour} onChange={(e) => setNewHour(Number(e.target.value))} aria-label="실행 시">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h.toString().padStart(2, "0")}시</option>)}
              </select><select value={newMinute} onChange={(e) => setNewMinute(Number(e.target.value))} aria-label="실행 분">{[0, 15, 30, 45].map((minute) => <option key={minute} value={minute}>{minute.toString().padStart(2, "0")}분</option>)}</select></span></label>
            </div>
            {newScheduleType === "weekly" && (
              <label className="form-label">요일<select value={newWeekday} onChange={(e) => setNewWeekday(Number(e.target.value))}>
                {WEEKDAYS_KO.map((wd, i) => <option key={i} value={i}>{wd}요일</option>)}
              </select></label>
            )}
            {newScheduleType === "monthly" && (
              <label className="form-label">일<select value={newMonthDay} onChange={(e) => setNewMonthDay(Number(e.target.value))}>
                {Array.from({ length: 31 }, (_, d) => <option key={d} value={d + 1}>{d + 1}일</option>)}
              </select></label>
            )}
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => setShowCreateModal(false)}>취소</button>
              <button type="button" className="schedule-create-btn" disabled={!newPrompt.trim() || creating} onClick={() => void handleCreate()}>{creating ? "생성 중..." : "예약 생성"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type PlannedWorkItem = {
  id: string;
  title: string;
  description: string | null;
  kind: "todo" | "milestone" | "reminder" | "execution";
  status: "open" | "in_progress" | "done" | "failed" | "cancelled";
  priority: "low" | "normal" | "high" | "urgent";
  due_at: string | null;
  source_type: string | null;
  auto_generated: number;
  notify_enabled: number;
};

type ScheduleAlertItem = PlannedWorkItem & { alert_type: "overdue" | "upcoming" };

const plannedKindLabels: Record<PlannedWorkItem["kind"], string> = {
  todo: "Todo",
  milestone: "마일스톤",
  reminder: "알림",
  execution: "실행",
};

const scheduleHourOptions = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const scheduleMinuteOptions = ["00", "30"];

type ScheduleItemsPayload = {
  id?: string;
  items?: PlannedWorkItem[];
  notifications?: ScheduleAlertItem[];
  error?: { message?: string; trace_id?: string };
};

async function readScheduleItemsResponse(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => ({})) as ScheduleItemsPayload;
  if (!response.ok) {
    const traceId = payload.error?.trace_id || response.headers.get("X-Trace-Id");
    const message = payload.error?.message || fallbackMessage;
    throw new Error(traceId ? `${message} (문의 코드: ${traceId})` : message);
  }
  return payload;
}

function SchedulePlanningBoard() {
  const [items, setItems] = useState<PlannedWorkItem[]>([]);
  const [alerts, setAlerts] = useState<ScheduleAlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<PlannedWorkItem["kind"]>("todo");
  const [priority, setPriority] = useState<PlannedWorkItem["priority"]>("normal");
  const [dueDate, setDueDate] = useState("");
  const [dueHour, setDueHour] = useState("09");
  const [dueMinute, setDueMinute] = useState("00");
  const [notify, setNotify] = useState(true);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [filter, setFilter] = useState<"all" | "open" | "done" | "attention">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/schedule-items", { headers: { Accept: "application/json" } });
      const data = await readScheduleItemsResponse(response, "업무 플래닝을 불러오지 못했습니다.");
      setItems(data.items || []);
      setAlerts(data.notifications || []);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "업무 플래닝을 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void load(); });
    return () => { active = false; };
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setKind("todo");
    setPriority("normal");
    setDueDate("");
    setDueHour("09");
    setDueMinute("00");
    setNotify(true);
    setEditingId(null);
    setShowForm(false);
  };

  const toDateTimeLocal = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  };

  const editItem = (item: PlannedWorkItem) => {
    setError("");
    setNotice("");
    setEditingId(item.id);
    setTitle(item.title);
    setDescription(item.description || "");
    setKind(item.kind);
    setPriority(item.priority);
    const localDueAt = item.due_at ? toDateTimeLocal(item.due_at) : "";
    setDueDate(localDueAt.slice(0, 10));
    setDueHour(localDueAt.slice(11, 13) || "09");
    setDueMinute(Number(localDueAt.slice(14, 16)) >= 30 ? "30" : "00");
    setNotify(Boolean(item.notify_enabled));
    setShowForm(true);
  };

  const save = async () => {
    if (title.trim().length < 2) { setError("업무 제목은 2자 이상 입력해 주세요."); return; }
    const isEditing = Boolean(editingId);
    setBusy(true); setError(""); setNotice("");
    try {
      const dueAt = dueDate ? new Date(`${dueDate}T${dueHour}:${dueMinute}:00`).toISOString() : null;
      const response = await fetch("/api/v1/schedule-items", {
        method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(editingId
          ? { id: editingId, title: title.trim(), description, kind, priority, notify_enabled: notify, due_at: dueAt }
          : { title: title.trim(), description, kind, priority, notify_enabled: notify, due_at: dueAt }),
      });
      await readScheduleItemsResponse(response, editingId ? "업무를 수정하지 못했습니다." : "업무를 등록하지 못했습니다.");
      resetForm();
      await load();
      setNotice(isEditing ? "업무 변경 내용을 저장했습니다." : "업무를 등록했습니다.");
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "업무를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const update = async (id: string, status: PlannedWorkItem["status"]) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/v1/schedule-items", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }),
      });
      await readScheduleItemsResponse(response, "업무 상태를 변경하지 못했습니다.");
      await load();
    } catch (updateError) { setError(updateError instanceof Error ? updateError.message : "업무 상태를 변경하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!window.confirm("이 업무를 삭제할까요?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/v1/schedule-items?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await readScheduleItemsResponse(response, "업무를 삭제하지 못했습니다.");
      await load();
    } catch (removeError) { setError(removeError instanceof Error ? removeError.message : "업무를 삭제하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const isOverdue = (item: PlannedWorkItem) => Boolean(item.due_at && Date.parse(item.due_at) <= currentTime && item.status !== "done" && item.status !== "cancelled");
  const visible = items.filter((item) => {
    if (filter === "all") return true;
    if (filter === "done") return item.status === "done";
    if (filter === "attention") return item.status === "failed" || isOverdue(item);
    return item.status === "open" || item.status === "in_progress";
  });
  const openCount = items.filter((item) => item.status === "open" || item.status === "in_progress").length;
  const dueCount = items.filter(isOverdue).length;

  return (
    <section className="schedule-planning-panel" aria-label="업무 플래닝과 Todo">
      <div className="schedule-planning-heading">
        <div><span className="section-kicker">WORK PLANNING · TODO</span><h2>업무 플래닝</h2><p>대화, Agent 실행, 승인에서 생성된 업무와 직접 등록한 Todo를 한 흐름으로 관리합니다.</p></div>
        <button type="button" className="schedule-create-btn" onClick={() => { setError(""); setNotice(""); if (showForm) resetForm(); else { setEditingId(null); setShowForm(true); } }}>{showForm ? "닫기" : "+ 업무 추가"}</button>
      </div>
      <div className="schedule-planning-metrics"><span><strong>{openCount}</strong> 진행 중</span><span><strong>{dueCount}</strong> 확인 필요</span><span><strong>{alerts.length}</strong> 알림</span><span><strong>{items.filter((item) => item.auto_generated === 1).length}</strong> 자동 등록</span></div>
      {error && <div className="schedule-alert" role="alert">{error}</div>}
      {notice && <div className="schedule-save-status" role="status">{notice}<button type="button" onClick={() => setNotice("")}>닫기</button></div>}
      {alerts.length > 0 && <div className="schedule-plan-alerts" role="status"><strong>확인이 필요한 업무</strong><span>{alerts.slice(0, 3).map((item) => `${item.alert_type === "overdue" ? "기한 초과" : "예정"} · ${item.title}`).join(" / ")}</span></div>}
      {showForm && <div className="schedule-plan-form">
        <label className="form-label">업무 제목<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 내일 설비 점검 결과 제출" minLength={2} maxLength={240} aria-describedby="schedule-title-hint" required autoFocus /><small id="schedule-title-hint">2~240자</small></label>
        <label className="form-label">설명<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="완료 기준이나 참고 내용을 적어 주세요." rows={2} /></label>
        <div className="form-row">
          <label className="form-label">종류<select value={kind} onChange={(event) => setKind(event.target.value as PlannedWorkItem["kind"])}>{Object.entries(plannedKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="form-label">우선순위<select value={priority} onChange={(event) => setPriority(event.target.value as PlannedWorkItem["priority"])}><option value="low">낮음</option><option value="normal">보통</option><option value="high">높음</option><option value="urgent">긴급</option></select></label>
          <label className="form-label">마감 시각<div className="schedule-plan-deadline-control"><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="마감 날짜" /><select value={dueHour} onChange={(event) => setDueHour(event.target.value)} aria-label="마감 시각 시">{scheduleHourOptions.map((hour) => <option key={hour} value={hour}>{hour}시</option>)}</select><select value={dueMinute} onChange={(event) => setDueMinute(event.target.value)} aria-label="마감 시각 분">{scheduleMinuteOptions.map((minute) => <option key={minute} value={minute}>{minute}분</option>)}</select></div><small className="schedule-plan-deadline-hint">24시간제 · 30분 단위</small></label>
        </div>
        <label className="schedule-checkbox"><input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} /> 마감 15분 전 알림</label>
        <div className="modal-actions"><button type="button" className="quiet-button" onClick={resetForm}>취소</button><button type="button" className="schedule-create-btn" disabled={title.trim().length < 2 || busy} onClick={() => void save()}>{busy ? "처리 중..." : editingId ? "변경 저장" : "업무 등록"}</button></div>
      </div>}
      <div className="schedule-planning-toolbar"><div className="schedule-filters" role="group" aria-label="업무 상태 필터">{(["all", "open", "attention", "done"] as const).map((value) => <button key={value} type="button" className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? "전체" : value === "open" ? "진행 중" : value === "attention" ? "확인 필요" : "완료"}</button>)}</div><span>{loading ? "불러오는 중..." : `${visible.length}개 업무`}</span></div>
      <div className="schedule-plan-list">{visible.length === 0 ? <p className="empty-state">등록된 업무가 없습니다. 대화에서 업무를 요청하거나 직접 할 일을 추가해 보세요.</p> : visible.map((item) => <article key={item.id} className={`schedule-plan-item schedule-plan-${item.status}`}>
        <div className="schedule-plan-check"><button type="button" disabled={busy} aria-label={item.status === "done" ? "업무 다시 열기" : "업무 완료"} onClick={() => void update(item.id, item.status === "done" ? "open" : "done")}>{item.status === "done" ? "✓" : "○"}</button></div>
        <div className="schedule-plan-content"><div className="schedule-plan-topline"><span className={`schedule-plan-priority priority-${item.priority}`}>{item.priority}</span><span>{plannedKindLabels[item.kind]}</span>{item.auto_generated === 1 && <span className="schedule-plan-auto">자동</span>}{item.status === "failed" && <span className="schedule-plan-failed-label">오류 확인</span>}</div><strong>{item.title}</strong>{item.description && <p>{item.description}</p>}{item.due_at && <small className={isOverdue(item) ? "schedule-plan-overdue" : ""}>마감 {new Date(item.due_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</small>}</div>
        <div className="schedule-plan-actions"><button type="button" disabled={busy} onClick={() => editItem(item)}>편집</button><button type="button" disabled={busy || item.status === "done"} onClick={() => void update(item.id, item.status === "failed" ? "open" : "in_progress")}>{item.status === "in_progress" ? "진행 중" : item.status === "failed" ? "재개" : "착수"}</button><button type="button" disabled={busy} onClick={() => void remove(item.id)}>삭제</button></div>
      </article>)}</div>
    </section>
  );
}
