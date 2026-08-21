import { getD1 } from "../db";
import type { Principal } from "./identity";
import { ensureRagSchema, RagError } from "./rag";
import { getRuntimeEnv, type RuntimeEnv } from "./runtime-env";
import { COMPANY_INDUSTRY, COMPANY_NAME } from "./company-profile";
import { referenceYearInSeoul } from "./reference-date";

export type InternetSearchProvider = "tavily" | "exa" | "google" | "naver" | "youtube" | "brave" | "webpilot" | "duckduckgo" | "jina" | "wikimedia";
export type InternetSourceCategory = "official" | "government" | "academic" | "reference" | "independent" | "unverified";
export type InternetSearchIntent = "current" | "comparison" | "how-to" | "research" | "fact";

export type InternetSearchResult = {
  id: string;
  title: string;
  url: string;
  snippet: string;
  score: number;
  source: string;
  sourceCategory: InternetSourceCategory;
  sourceCategoryLabel: string;
  sourceVerification: "official" | "independent" | "public" | "unverified";
  publishedAt?: string;
};

export type InternetSearchPlan = {
  originalQuery: string;
  searchQuery: string;
  queries: string[];
  intent: InternetSearchIntent;
  language: "ko" | "en";
  freshness?: "pd" | "pw" | "pm" | "py";
  latestRequired: boolean;
  asOf: string;
};

export type InternetSearchAttempt = {
  provider: InternetSearchProvider;
  status: "success" | "empty" | "failed" | "skipped";
  resultCount: number;
  latencyMs: number;
  detail: string;
};

export type InternetSearchResponse = {
  query: string;
  searchQuery: string;
  provider: InternetSearchProvider;
  /** 결과에 실제로 기여한 모든 Provider. 여러 개면 응답이 다중 출처를 종합한 것이다. */
  providersUsed: InternetSearchProvider[];
  results: InternetSearchResult[];
  latencyMs: number;
  traceId: string;
  fallbackUsed: boolean;
  plan: InternetSearchPlan;
  providerPath: InternetSearchAttempt[];
  quality: {
    mode: "full-web" | "reference-fallback";
    uniqueDomains: number;
    enrichedResults: number;
    freshnessApplied: boolean;
    datedResults: number;
    asOf: string;
  };
};

export type InternetSearchProviderStatus = {
  id: InternetSearchProvider;
  name: string;
  order: number;
  configured: boolean;
  capability: string;
  configuration: string;
};

export type InternetSearchStatus = {
  configured: boolean;
  preferredProvider: InternetSearchProvider;
  fallbackProvider?: InternetSearchProvider;
  activeProvider: InternetSearchProvider;
  status: "ready" | "fallback";
  detail: string;
  providers: InternetSearchProviderStatus[];
};

export type InternetSearchProbe = {
  status: "ready" | "degraded" | "failed";
  provider: InternetSearchProvider;
  latencyMs: number;
  resultCount: number;
  fallbackUsed: boolean;
  providerPath: InternetSearchAttempt[];
  detail: string;
  checkedAt: string;
};

type ProviderAdapter = {
  id: InternetSearchProvider;
  configured: (runtime: RuntimeEnv) => boolean;
  search: (query: string, limit: number, runtime: RuntimeEnv) => Promise<InternetSearchResult[]>;
};

const WIKIMEDIA_USER_AGENT = "ILJIN-AI-Portal/1.0 (https://iljin-ai-works.pages.dev)";
const DEFAULT_PROVIDER_ORDER: InternetSearchProvider[] = ["google", "naver", "youtube", "tavily", "exa", "brave", "webpilot", "duckduckgo", "jina"];
const FRESHNESS_PATTERN = /\b(today|latest|current|recent|news|update|release|price)\b|오늘|최신|현재|최근|뉴스|동향|출시|업데이트|가격|시세|이번\s*(주|달|분기|해)/i;
const HISTORICAL_PATTERN = /\b(history|historical|formerly|past|archive)\b|역사|과거|당시|연혁|예전|아카이브/i;
const COMPARISON_PATTERN = /\b(compare|comparison|versus|vs\.?|difference|best)\b|비교|차이|장단점|추천|순위/i;
const HOW_TO_PATTERN = /\b(how|guide|tutorial|steps?)\b|방법|절차|사용법|설정|구축|가이드/i;
const RESEARCH_PATTERN = /(리서치|조사|현황|동향|벤치마킹|사업계획서|경쟁사|업계|기업들|research|landscape|benchmark)/i;
const CONTEXT_REFERENCE_PATTERN = /^(그|그것|그거|이것|저것|해당|앞에서|그러면|그래서|그럼|비교|장단점|어떻게|언제|어디|왜)\b|그\s*(내용|제품|회사|기술|모델|정책|사건)/i;
const SEARCH_FILLERS = new Set([
  "무엇", "뭐야", "알려줘", "알려주세요", "설명", "설명해줘", "설명해주세요",
  "정리", "정리해줘", "정리해주세요", "관련", "대한", "대해서", "해주세요",
  "what", "why", "how", "tell", "explain", "please", "about",
]);

const PROVIDER_META: Record<InternetSearchProvider, Omit<InternetSearchProviderStatus, "order" | "configured">> = {
  tavily: {
    id: "tavily",
    name: "Tavily Search",
    capability: "LLM용 본문 추출, 관련도 점수, 최신성 필터",
    configuration: "TAVILY_API_KEY",
  },
  exa: {
    id: "exa",
    name: "Exa Search",
    capability: "임베딩 기반 의미론적 검색 · 본문 하이라이트 추출 (키워드 검색과 다른 후보군 확보)",
    configuration: "EXA_API_KEY",
  },
  google: {
    id: "google",
    name: "Google Programmable Search",
    capability: "Google Custom Search JSON API 기반 범용 웹 검색",
    configuration: "GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID",
  },
  naver: {
    id: "naver",
    name: "NAVER Search",
    capability: "NAVER API HUB 웹문서·뉴스 검색, 한국어 최신 정보 보강",
    configuration: "NAVER_API_HUB_CLIENT_ID + NAVER_API_HUB_CLIENT_SECRET",
  },
  youtube: {
    id: "youtube",
    name: "YouTube Search",
    capability: "YouTube Data API 기반 영상·채널·게시일 검색",
    configuration: "YOUTUBE_API_KEY 또는 GOOGLE_SEARCH_API_KEY",
  },
  brave: {
    id: "brave",
    name: "Brave Search",
    capability: "맞춤법 교정, 최신성 필터, 추가 본문 조각",
    configuration: "BRAVE_SEARCH_API_KEY",
  },
  webpilot: {
    id: "webpilot",
    name: "WebPilot 호환 API",
    capability: "관리자 제공 호환 Endpoint의 정규화된 검색 결과",
    configuration: "WEBPILOT_API_URL + WEBPILOT_API_KEY",
  },
  duckduckgo: {
    id: "duckduckgo",
    name: "DuckDuckGo Web Search",
    capability: "API Key 불필요 범용 웹 검색, 상위 결과 본문 자동 추출",
    configuration: "항상 사용 가능",
  },
  jina: {
    id: "jina",
    name: "Jina AI Search",
    capability: "Jina Reader + Search 기반 AI 의미 검색, Markdown 본문 추출 (Agent Reach 통합)",
    configuration: "JINA_API_KEY (선택, 무료 Rate Limit 있음)",
  },
  wikimedia: {
    id: "wikimedia",
    name: "Wikimedia",
    capability: "API Key가 없을 때 사용하는 공개 백과사전 본문 검색",
    configuration: "항상 사용 가능",
  },
};

function stripMarkup(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

// 사용자가 일진 계열 공식 서비스로 오인되는 사례를 보고한 도메인이다.
// 검색 결과·인용·연관 질문의 근거로 쓰기 전에 전역적으로 제외한다.
const BLOCKED_MISATTRIBUTED_ILJIN_DOMAINS = new Set([
  "jinjai.net",
  "jinjaimobile.com",
]);

function isBlockedMisattributedIljinDomain(host: string) {
  const normalized = host.toLowerCase().replace(/^www\./, "");
  return [...BLOCKED_MISATTRIBUTED_ILJIN_DOMAINS].some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

function configuredDomains(value?: string) {
  return (value || "").split(",")
    .map((domain) => domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
    .filter(Boolean);
}

function matchesConfiguredDomain(host: string, domains: string[]) {
  const normalized = host.toLowerCase().replace(/^www\./, "");
  return domains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

function classifySource(value: string): Pick<InternetSearchResult, "sourceCategory" | "sourceCategoryLabel" | "sourceVerification"> {
  const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  const runtime = getRuntimeEnv();
  if (matchesConfiguredDomain(host, configuredDomains(runtime.ILJIN_OFFICIAL_SOURCE_DOMAINS))) {
    return { sourceCategory: "official", sourceCategoryLabel: "공식 확인", sourceVerification: "official" };
  }
  if (matchesConfiguredDomain(host, configuredDomains(runtime.ILJIN_TRUSTED_INDEPENDENT_SOURCE_DOMAINS))) {
    return { sourceCategory: "independent", sourceCategoryLabel: "독립 제3자 보도", sourceVerification: "independent" };
  }
  if (host.endsWith(".go.kr") || host.endsWith(".gov") || host.endsWith(".gov.kr")) {
    return { sourceCategory: "government", sourceCategoryLabel: "정부·공공 출처", sourceVerification: "public" };
  }
  if (host.endsWith(".ac.kr") || host.endsWith(".edu") || host.endsWith(".edu.kr")) {
    return { sourceCategory: "academic", sourceCategoryLabel: "교육·연구 출처", sourceVerification: "public" };
  }
  if (host.endsWith("wikipedia.org") || host.endsWith("wikimedia.org")) {
    return { sourceCategory: "reference", sourceCategoryLabel: "공개 백과사전", sourceVerification: "public" };
  }
  return { sourceCategory: "unverified", sourceCategoryLabel: "미검증 공개 웹", sourceVerification: "unverified" };
}

function trimText(value: string, maxLength = 1_800) {
  const clean = stripMarkup(value);
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1).trim()}…`;
}

function searchLanguage(query: string) {
  return /[가-힣]/.test(query)
    ? { language: "ko" as const, country: "kr", searchLang: "ko", uiLang: "ko-KR" }
    : { language: "en" as const, country: "us", searchLang: "en", uiLang: "en-US" };
}

function freshnessForQuery(query: string) {
  const currentYear = referenceYearInSeoul();
  if (!FRESHNESS_PATTERN.test(query) && !new RegExp(`\\b${currentYear}\\b`).test(query)) return undefined;
  if (/오늘|today|24\s*hours?/i.test(query)) return "pd" as const;
  if (/이번\s*주|week|주간/i.test(query)) return "pw" as const;
  if (/이번\s*달|month|월간/i.test(query)) return "pm" as const;
  return "pw" as const;
}

function isExplicitHistoricalQuery(query: string) {
  if (HISTORICAL_PATTERN.test(query)) return true;
  const currentYear = referenceYearInSeoul();
  const years = [...query.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  return years.some((year) => year !== currentYear) && !FRESHNESS_PATTERN.test(query);
}

function requiresCurrentYearEvidence(query: string) {
  const currentYear = referenceYearInSeoul();
  const years = [...query.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  return !isExplicitHistoricalQuery(query)
    && !years.some((year) => year !== currentYear)
    && (FRESHNESS_PATTERN.test(query) || years.includes(currentYear));
}

function optimizeSearchQuery(value: string) {
  const tokens = value
    .replace(/[?!.,()[\]{}]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.length > 2
      ? token.replace(/(으로|에서|에게|부터|까지|처럼|보다|에는|에서는|이며|이고|와|과|가|이|를|을)$/u, "")
      : token)
    .filter((token) => token.length > 1 && !SEARCH_FILLERS.has(token.toLocaleLowerCase("ko-KR")));
  return [...new Set(tokens)].join(" ").trim() || value.trim();
}

function contextualSearchQuery(query: string, context: string[] = []) {
  const cleanContext = context
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item !== query)
    .slice(-2);
  const needsContext = query.length < 28 || CONTEXT_REFERENCE_PATTERN.test(query);
  if (!needsContext || !cleanContext.length) return optimizeSearchQuery(query);
  const anchor = cleanContext.join(" ").slice(-240);
  return optimizeSearchQuery(`${anchor} ${query}`).replace(/\s+/g, " ").trim().slice(0, 500);
}

const AMBIGUOUS_COMPANY_QUERY_PATTERN = /(일진|iljin)/i;
const COMPANY_CONTEXT_QUERY_PATTERN = /(기업|회사|사업|제품|서비스|ai|산업|제조|베어링|매출|실적|공장|공급|품질|기술|동향|연혁|계열|법인|시장|company|business|product|service|industry|manufactur|bearing)/i;
const EXPLICIT_OTHER_ILJIN_ENTITY_PATTERN = /(일진그룹|일진홀딩스|일진전기|일진머티리얼즈|일진하이솔루스|iljin\s+(group|electric|materials|hi-solis))/i;

function prioritizeCompanySearchQuery(query: string) {
  if (
    !AMBIGUOUS_COMPANY_QUERY_PATTERN.test(query)
    || !COMPANY_CONTEXT_QUERY_PATTERN.test(query)
    || /일진글로벌|iljin\s+global/i.test(query)
    || EXPLICIT_OTHER_ILJIN_ENTITY_PATTERN.test(query)
  ) return query;
  return `${COMPANY_NAME} ${COMPANY_INDUSTRY} ${query}`;
}

function isCompanyIdentityQuery(query: string) {
  return /일진글로벌|iljin\s+global/i.test(query)
    || (AMBIGUOUS_COMPANY_QUERY_PATTERN.test(query) && COMPANY_CONTEXT_QUERY_PATTERN.test(query));
}

/**
 * 기업·브랜드·법인 관계 질문은 승인된 공식 출처 1건 또는 서로 다른 승인 독립 보도
 * 2건이 있을 때만 모델 근거로 사용한다. 검색 순위나 도메인명은 법인 관계의 근거가 아니다.
 */
function companyClaimEligibleResults(query: string, results: InternetSearchResult[]) {
  if (!isCompanyIdentityQuery(query)) return results;
  const official = results.filter((result) => result.sourceVerification === "official");
  if (official.length) return results.filter((result) => result.sourceVerification === "official" || result.sourceVerification === "independent");
  const independentDomains = new Set(results
    .filter((result) => result.sourceVerification === "independent")
    .map((result) => result.source));
  return independentDomains.size >= 2
    ? results.filter((result) => result.sourceVerification === "independent")
    : [];
}

export function buildSearchPlan(query: string, context: string[] = []): InternetSearchPlan {
  const searchQuery = contextualSearchQuery(prioritizeCompanySearchQuery(query), context);
  const requestedFreshness = freshnessForQuery(searchQuery);
  const latestRequired = Boolean(requestedFreshness) || !isExplicitHistoricalQuery(searchQuery);
  const freshness = requestedFreshness || (latestRequired ? "py" as const : undefined);
  const locale = searchLanguage(searchQuery);
  // Classify the user's purpose before applying the default freshness policy.
  // Most ordinary questions are searched with a recent-year filter, but that
  // does not make a comparison or how-to request a "current"-intent query.
  const intent: InternetSearchIntent = RESEARCH_PATTERN.test(searchQuery)
    ? "research"
    : COMPARISON_PATTERN.test(searchQuery)
    ? "comparison"
    : HOW_TO_PATTERN.test(searchQuery)
      ? "how-to"
      : latestRequired
        ? "current"
        : "fact";
  const currentYear = referenceYearInSeoul();
  const currentYearRequired = requiresCurrentYearEvidence(searchQuery);
  const queryWithCurrentYear = currentYearRequired && !new RegExp(`\\b${currentYear}\\b`).test(searchQuery)
    ? `${searchQuery} ${currentYear}`
    : searchQuery;
  const variants: string[] = [];
  if (intent === "research") {
    variants.push(queryWithCurrentYear);
    variants.push(`${queryWithCurrentYear} ${locale.language === "ko" ? "글로벌 국내 기업 사례 정책 ROI" : "global enterprise cases policy ROI"}`);
  } else if (intent === "comparison") {
    variants.push(searchQuery);
    variants.push(`${searchQuery} ${locale.language === "ko" ? "공식 자료 사양" : "official specifications"}`);
  } else if (intent === "how-to") {
    variants.push(searchQuery);
    variants.push(`${searchQuery} ${locale.language === "ko" ? "공식 가이드" : "official guide"}`);
  } else if (currentYearRequired) {
    variants.push(searchQuery);
    variants.push(queryWithCurrentYear);
  } else {
    variants.push(searchQuery);
  }
  return {
    originalQuery: query,
    searchQuery,
    queries: [...new Set(variants)].slice(0, 2),
    intent,
    language: locale.language,
    freshness,
    latestRequired,
    asOf: new Date().toISOString(),
  };
}

function wikimediaSearchVariants(query: string) {
  const optimized = optimizeSearchQuery(query);
  const titleTokens = optimized
    .split(/\s+/)
    .filter((token) => !["차이", "비교", "장점", "단점", "최신", "현재", "최근"].includes(token))
    .slice(0, 2);
  const titleQuery = titleTokens.length ? `intitle:${titleTokens.join(" ")}` : "";
  const categoryTitleQuery = titleTokens.length > 1 ? `intitle:${titleTokens.at(-1)}` : "";
  return [...new Set([titleQuery, categoryTitleQuery, optimized].filter(Boolean))];
}

function tokenize(value: string) {
  return new Set(
    value
      .toLocaleLowerCase("ko-KR")
      .split(/[^\p{L}\p{N}]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length > 1),
  );
}

function relevanceScore(query: string, result: InternetSearchResult) {
  const queryTokens = tokenize(query);
  const resultTokens = tokenize(`${result.title} ${result.snippet} ${result.source}`);
  const overlap = queryTokens.size
    ? [...queryTokens].filter((token) => resultTokens.has(token)).length / queryTokens.size
    : 0;
  const authority = result.sourceCategory === "government"
    ? 0.14
    : result.sourceCategory === "academic"
      ? 0.12
      : result.sourceCategory === "reference"
        ? 0.08
        : result.sourceCategory === "official"
          ? 0.16
          : result.sourceCategory === "independent"
            ? 0.1
            : 0;
  const exactTitle = result.title.toLocaleLowerCase("ko-KR").includes(query.toLocaleLowerCase("ko-KR")) ? 0.1 : 0;
  const publishedAt = result.publishedAt ? Date.parse(result.publishedAt) : Number.NaN;
  const ageDays = Number.isFinite(publishedAt) ? Math.max(0, (Date.now() - publishedAt) / 86_400_000) : Number.POSITIVE_INFINITY;
  const recency = isExplicitHistoricalQuery(query)
    ? 0
    : ageDays <= 30
      ? 0.14
      : ageDays <= 180
        ? 0.1
        : ageDays <= 365
          ? 0.07
          : ageDays <= 1_095
            ? 0.03
            : 0;
  const currentYear = referenceYearInSeoul();
  const publishedYear = Number.isFinite(publishedAt) ? referenceYearInSeoul(new Date(publishedAt)) : undefined;
  const currentYearWeight = requiresCurrentYearEvidence(query)
    ? publishedYear === currentYear ? 0.08 : publishedYear && publishedYear < currentYear ? -0.08 : 0
    : 0;
  return Math.max(0, Math.min(1, result.score * 0.5 + overlap * 0.32 + authority + exactTitle + recency + currentYearWeight));
}

function isSyndicatedDuplicate(left: InternetSearchResult, right: InternetSearchResult) {
  const leftTokens = tokenize(`${left.title} ${left.snippet}`);
  const rightTokens = tokenize(`${right.title} ${right.snippet}`);
  const smaller = Math.min(leftTokens.size, rightTokens.size);
  if (smaller < 10) return false;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / smaller >= 0.86;
}

function isWithinRecentWeek(result: InternetSearchResult) {
  const publishedAt = result.publishedAt ? Date.parse(result.publishedAt) : Number.NaN;
  return Number.isFinite(publishedAt) && publishedAt <= Date.now() && Date.now() - publishedAt <= 7 * 86_400_000;
}

export function rerankResults(query: string, input: InternetSearchResult[], limit: number, freshness?: InternetSearchPlan["freshness"]) {
  const seenUrls = new Set<string>();
  const hostCounts = new Map<string, number>();
  const selected: InternetSearchResult[] = [];
  const uniqueHosts = new Set(input.map((result) => result.source)).size;
  const maxPerHost = uniqueHosts <= 1 ? limit : uniqueHosts === 2 ? Math.ceil(limit / 2) : 2;
  return (freshness === "pw" ? input.filter(isWithinRecentWeek) : input)
    .map((result) => ({ ...result, score: Number(relevanceScore(query, result).toFixed(4)) }))
    .sort((left, right) => right.score - left.score)
    .filter((result) => {
      const normalized = result.url.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
      if (seenUrls.has(normalized)) return false;
      if (selected.some((current) => isSyndicatedDuplicate(current, result))) return false;
      const hostCount = hostCounts.get(result.source) || 0;
      if (hostCount >= maxPerHost) return false;
      seenUrls.add(normalized);
      hostCounts.set(result.source, hostCount + 1);
      selected.push(result);
      return true;
    })
    .slice(0, limit);
}

async function fetchJson(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`internet_search_http_${response.status}`);
    return await response.json() as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

/** makeResult() 가 id 에 새겨 둔 Provider 접두어를 되읽는다("web_tavily_3" → "tavily"). */
function providerOfResult(result: InternetSearchResult): InternetSearchProvider | undefined {
  const match = /^web_([a-z]+)_/.exec(result.id);
  const candidate = match?.[1];
  return candidate && candidate in PROVIDER_ADAPTERS ? candidate as InternetSearchProvider : undefined;
}

function makeResult(
  provider: InternetSearchProvider,
  index: number,
  item: { title?: string; url?: string; snippet?: string; score?: number; publishedAt?: string },
) {
  const resultUrl = safeHttpUrl(item.url || "");
  const title = stripMarkup(item.title || "");
  if (!resultUrl || !title) return undefined;
  const source = new URL(resultUrl).hostname.replace(/^www\./, "");
  // Wikimedia/Wikipedia is intentionally excluded from every provider's
  // normalized result set, not only from the legacy fallback path.
  if (source.endsWith("wikipedia.org") || source.endsWith("wikimedia.org")) return undefined;
  if (isBlockedMisattributedIljinDomain(source)) return undefined;
  return {
    id: `web_${provider}_${index + 1}`,
    title,
    url: resultUrl,
    snippet: trimText(item.snippet || "") || "검색 결과 원문에서 내용을 확인해 주세요.",
    score: Number(Math.max(0.35, Math.min(item.score ?? 1 - index * 0.06, 1)).toFixed(4)),
    source,
    ...classifySource(resultUrl),
    publishedAt: item.publishedAt,
  } satisfies InternetSearchResult;
}

async function tavilySearch(query: string, limit: number, runtime: RuntimeEnv) {
  const freshness = freshnessForQuery(query);
  const timeRange = freshness === "pd" ? "day" : freshness === "pw" ? "week" : freshness === "pm" ? "month" : freshness === "py" ? "year" : undefined;
  const locale = searchLanguage(query);
  const payload = await fetchJson("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${runtime.TAVILY_API_KEY?.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      topic: "general",
      search_depth: "advanced",
      max_results: Math.min(Math.max(limit * 2, 8), 20),
      include_answer: false,
      include_raw_content: "text",
      time_range: timeRange,
      country: locale.language === "ko" ? "south korea" : undefined,
      auto_parameters: false,
    }),
  }) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      raw_content?: string;
      score?: number;
      published_date?: string;
    }>;
  };
  return (payload.results || []).flatMap((item, index) => {
    const result = makeResult("tavily", index, {
      title: item.title,
      url: item.url,
      snippet: item.raw_content || item.content,
      score: item.score,
      publishedAt: item.published_date,
    });
    return result ? [result] : [];
  });
}

async function exaSearch(query: string, limit: number, runtime: RuntimeEnv) {
  const payload = await fetchJson("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "x-api-key": runtime.EXA_API_KEY?.trim() || "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: Math.min(Math.max(limit * 2, 8), 20),
      contents: { text: { maxCharacters: 1_800 }, highlights: true },
    }),
  }) as {
    results?: Array<{
      title?: string;
      url?: string;
      publishedDate?: string;
      text?: string;
      highlights?: string[];
      score?: number;
    }>;
  };
  return (payload.results || []).flatMap((item, index) => {
    const result = makeResult("exa", index, {
      title: item.title,
      url: item.url,
      snippet: (item.highlights || []).join(" ") || item.text,
      score: item.score,
      publishedAt: item.publishedDate,
    });
    return result ? [result] : [];
  });
}

async function googleSearch(query: string, limit: number, runtime: RuntimeEnv) {
  const url = new URL("https://customsearch.googleapis.com/customsearch/v1");
  const locale = searchLanguage(query);
  url.searchParams.set("key", runtime.GOOGLE_SEARCH_API_KEY?.trim() || "");
  url.searchParams.set("cx", runtime.GOOGLE_SEARCH_ENGINE_ID?.trim() || "");
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(Math.max(limit, 1), 10)));
  url.searchParams.set("safe", "active");
  url.searchParams.set("gl", locale.country);
  url.searchParams.set("lr", `lang_${locale.searchLang}`);
  const payload = await fetchJson(url.toString(), { headers: { Accept: "application/json" } }) as {
    items?: Array<{
      title?: string;
      link?: string;
      snippet?: string;
      pagemap?: { metatags?: Array<Record<string, string>> };
    }>;
  };
  return (payload.items || []).flatMap((item, index) => {
    const meta = item.pagemap?.metatags?.[0] || {};
    const result = makeResult("google", index, {
      title: item.title,
      url: item.link,
      snippet: [item.snippet, meta["og:description"], meta.description].filter(Boolean).join(" "),
      publishedAt: meta["article:published_time"] || meta.date || meta.datepublished,
    });
    return result ? [result] : [];
  });
}

async function naverSearch(query: string, limit: number, runtime: RuntimeEnv) {
  const headers = {
    Accept: "application/json",
    "X-NCP-APIGW-API-KEY-ID": runtime.NAVER_API_HUB_CLIENT_ID?.trim() || "",
    "X-NCP-APIGW-API-KEY": runtime.NAVER_API_HUB_CLIENT_SECRET?.trim() || "",
  };
  const endpoint = (kind: "webkr" | "news") => {
    const url = new URL(`https://naverapihub.apigw.ntruss.com/search/v1/${kind}`);
    url.searchParams.set("query", query);
    url.searchParams.set("display", String(Math.min(Math.max(limit, 1), 10)));
    url.searchParams.set("start", "1");
    url.searchParams.set("format", "json");
    if (kind === "news") url.searchParams.set("sort", freshnessForQuery(query) ? "date" : "sim");
    return url.toString();
  };
  const kinds: Array<"webkr" | "news"> = freshnessForQuery(query) ? ["news", "webkr"] : ["webkr"];
  const payloads = await Promise.all(kinds.map(async (kind) => ({
    kind,
    payload: await fetchJson(endpoint(kind), { headers }) as {
      items?: Array<{ title?: string; link?: string; originallink?: string; description?: string; pubDate?: string }>;
    },
  })));
  return payloads.flatMap(({ kind, payload }) => (payload.items || []).flatMap((item, index) => {
    const result = makeResult("naver", index, {
      title: item.title,
      url: item.originallink || item.link,
      snippet: item.description,
      publishedAt: item.pubDate,
    });
    return result ? [{ ...result, id: `web_naver_${kind}_${index + 1}`, sourceCategoryLabel: result.sourceVerification === "unverified" ? (kind === "news" ? "NAVER 뉴스 · 미검증" : "NAVER 웹문서 · 미검증") : result.sourceCategoryLabel }] : [];
  }));
}

async function youtubeSearch(query: string, limit: number, runtime: RuntimeEnv) {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  const locale = searchLanguage(query);
  url.searchParams.set("key", runtime.YOUTUBE_API_KEY?.trim() || runtime.GOOGLE_SEARCH_API_KEY?.trim() || "");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", String(Math.min(Math.max(limit, 1), 10)));
  url.searchParams.set("safeSearch", "strict");
  url.searchParams.set("regionCode", locale.country.toUpperCase());
  url.searchParams.set("relevanceLanguage", locale.searchLang);
  url.searchParams.set("order", freshnessForQuery(query) ? "date" : "relevance");
  const payload = await fetchJson(url.toString(), { headers: { Accept: "application/json" } }) as {
    items?: Array<{
      id?: { videoId?: string };
      snippet?: { title?: string; description?: string; channelTitle?: string; publishedAt?: string };
    }>;
  };
  return (payload.items || []).flatMap((item, index) => {
    const videoId = item.id?.videoId;
    if (!videoId) return [];
    const snippet = item.snippet || {};
    const result = makeResult("youtube", index, {
      title: snippet.title,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      snippet: [snippet.channelTitle ? `채널: ${snippet.channelTitle}.` : "", snippet.description || ""].filter(Boolean).join(" "),
      publishedAt: snippet.publishedAt,
    });
    return result ? [{ ...result, sourceCategoryLabel: result.sourceVerification === "unverified" ? "YouTube 동영상 · 미검증" : result.sourceCategoryLabel }] : [];
  });
}

async function braveSearch(query: string, limit: number, runtime: RuntimeEnv) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  const locale = searchLanguage(query);
  const freshness = freshnessForQuery(query);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(Math.max(limit * 2, 12), 20)));
  url.searchParams.set("country", locale.country);
  url.searchParams.set("search_lang", locale.searchLang);
  url.searchParams.set("ui_lang", locale.uiLang);
  url.searchParams.set("safesearch", "strict");
  url.searchParams.set("spellcheck", "true");
  url.searchParams.set("extra_snippets", "true");
  url.searchParams.set("text_decorations", "false");
  if (freshness) url.searchParams.set("freshness", freshness);
  const payload = await fetchJson(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": runtime.BRAVE_SEARCH_API_KEY?.trim() || "",
    },
  }) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string; extra_snippets?: string[]; age?: string; page_age?: string }> };
  };
  return (payload.web?.results || []).flatMap((item, index) => {
    const result = makeResult("brave", index, {
      title: item.title,
      url: item.url,
      snippet: [item.description || "", ...(item.extra_snippets || [])].filter(Boolean).join(" "),
      publishedAt: item.page_age || item.age,
    });
    return result ? [result] : [];
  });
}

async function webpilotSearch(query: string, limit: number, runtime: RuntimeEnv) {
  const endpoint = safeHttpUrl(runtime.WEBPILOT_API_URL?.trim() || "");
  if (!endpoint) throw new Error("webpilot_endpoint_invalid");
  const payload = await fetchJson(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${runtime.WEBPILOT_API_KEY?.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, limit }),
  }) as {
    results?: Array<Record<string, unknown>>;
    data?: { results?: Array<Record<string, unknown>> };
  };
  const rows = payload.results || payload.data?.results || [];
  return rows.flatMap((item, index) => {
    const result = makeResult("webpilot", index, {
      title: String(item.title || ""),
      url: String(item.url || item.link || ""),
      snippet: String(item.content || item.snippet || item.description || ""),
      score: typeof item.score === "number" ? item.score : undefined,
      publishedAt: typeof item.publishedAt === "string"
        ? item.publishedAt
        : typeof item.published_date === "string"
          ? item.published_date
          : undefined,
    });
    return result ? [result] : [];
  });
}

async function jinaReaderFetch(url: string, maxChars = 1_600): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const headers: Record<string, string> = {
      Accept: "text/plain",
      "User-Agent": "Mozilla/5.0 (compatible; ILJIN-AI-Portal/1.0; +https://iljin-ai-works.pages.dev)",
    };
    const runtime = getRuntimeEnv();
    if (runtime.JINA_API_KEY?.trim()) {
      headers["Authorization"] = `Bearer ${runtime.JINA_API_KEY.trim()}`;
    }
    const response = await fetch(`https://r.jina.ai/${url}`, {
      signal: controller.signal,
      headers,
      redirect: "follow",
    });
    if (!response.ok) return undefined;
    const text = await response.text();
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return undefined;
    return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars - 1).trim()}…` : cleaned;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function enrichPageContent(url: string, maxChars = 1_600): Promise<string | undefined> {
  const jinaResult = await jinaReaderFetch(url, maxChars);
  if (jinaResult && jinaResult.length > 120) return jinaResult;
  return fetchPageText(url, maxChars);
}

async function fetchPageText(url: string, maxChars = 1_600): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ILJIN-AI-Portal/1.0; +https://iljin-ai-works.pages.dev)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!response.ok) return undefined;
    const contentType = (response.headers.get("Content-Type") || "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml")) {
      return undefined;
    }
    const raw = await response.text();
    const cleaned = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars - 1).trim()}…` : cleaned;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function duckduckgoSearch(query: string, limit: number): Promise<InternetSearchResult[]> {
  const locale = searchLanguage(query);
  const formData = new URLSearchParams();
  formData.set("q", query);
  formData.set("kl", locale.language === "ko" ? "kr-kr" : "us-en");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  let html: string;
  try {
    const response = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": locale.language === "ko" ? "ko-KR,ko;q=0.9" : "en-US,en;q=0.9",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`duckduckgo_http_${response.status}`);
    html = await response.text();
  } finally {
    clearTimeout(timer);
  }

  const linkPattern = /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetPattern = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/g;

  const links: Array<{ url: string; title: string }> = [];
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkPattern.exec(html))) {
    const redirectHref = linkMatch[1].replace(/^\/\//, "https://");
    const uddgMatch = redirectHref.match(/[?&]uddg=([^&]+)/);
    const actualUrl = uddgMatch ? safeHttpUrl(decodeURIComponent(uddgMatch[1])) : safeHttpUrl(redirectHref);
    const title = stripMarkup(linkMatch[2]);
    if (actualUrl && title) links.push({ url: actualUrl, title });
  }

  const snippets: string[] = [];
  let snippetMatch: RegExpExecArray | null;
  while ((snippetMatch = snippetPattern.exec(html))) {
    snippets.push(stripMarkup(snippetMatch[1]));
  }

  const count = Math.min(links.length, Math.max(limit * 2, 8));
  const baseResults: InternetSearchResult[] = [];
  for (let i = 0; i < count; i++) {
    const result = makeResult("duckduckgo", i, {
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] || "",
      score: Math.max(0.4, 0.9 - i * 0.05),
    });
    if (result) baseResults.push(result);
  }

  if (!baseResults.length) return [];

  const enrichCount = Math.min(baseResults.length, 3);
  const enriched = await Promise.all(
    baseResults.slice(0, enrichCount).map(async (result) => {
      const pageText = await enrichPageContent(result.url, 1_600);
      return pageText && pageText.length > result.snippet.length + 60
        ? { ...result, snippet: pageText }
        : result;
    }),
  );
  return [...enriched, ...baseResults.slice(enrichCount)];
}

async function jinaSearch(query: string, limit: number, runtime: RuntimeEnv): Promise<InternetSearchResult[]> {
  const searchUrl = `https://s.jina.ai/${encodeURIComponent(query)}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; ILJIN-AI-Portal/1.0; +https://iljin-ai-works.pages.dev)",
  };
  if (runtime.JINA_API_KEY?.trim()) {
    headers["Authorization"] = `Bearer ${runtime.JINA_API_KEY.trim()}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  let payload: Record<string, unknown>;
  try {
    const response = await fetch(searchUrl, {
      signal: controller.signal,
      headers,
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`jina_http_${response.status}`);
    const contentType = (response.headers.get("Content-Type") || "").toLowerCase();
    if (contentType.includes("application/json")) {
      payload = await response.json() as Record<string, unknown>;
    } else {
      const text = await response.text();
      const extracted = [...text.matchAll(/https?:\/\/[^\s)"'\]]+/g)].map((m) => m[0]);
      payload = { data: extracted.slice(0, 8).map((url, i) => ({
        title: text.slice(text.indexOf(url) - 80, text.indexOf(url)).trim().slice(0, 200) || `Result ${i + 1}`,
        url,
        content: text.slice(0, 4_000),
      })) };
    }
  } finally {
    clearTimeout(timer);
  }

  const data = (payload.data as Array<Record<string, unknown>>) || [];
  return data.flatMap((item, index) => {
    const result = makeResult("jina", index, {
      title: String(item.title || ""),
      url: String(item.url || ""),
      snippet: String(item.content || item.description || ""),
      score: Math.max(0.4, 0.92 - index * 0.04),
    });
    return result ? [result] : [];
  }).slice(0, Math.max(limit * 2, 8));
}

async function wikimediaSearch(query: string, limit: number) {
  const koreanQuery = /[가-힣]/.test(query);
  const hosts = koreanQuery ? ["ko.wikipedia.org", "en.wikipedia.org"] : ["en.wikipedia.org", "ko.wikipedia.org"];
  for (const host of hosts) {
    const variantRows = await Promise.all(wikimediaSearchVariants(query).map(async (searchVariant) => {
      const url = new URL(`https://${host}/w/api.php`);
      url.searchParams.set("action", "query");
      url.searchParams.set("generator", "search");
      url.searchParams.set("gsrsearch", searchVariant);
      url.searchParams.set("gsrlimit", String(Math.min(Math.max(limit, 5), 10)));
      url.searchParams.set("prop", "extracts|info");
      url.searchParams.set("exintro", "1");
      url.searchParams.set("explaintext", "1");
      url.searchParams.set("exchars", "1600");
      url.searchParams.set("inprop", "url");
      url.searchParams.set("utf8", "1");
      url.searchParams.set("format", "json");
      url.searchParams.set("formatversion", "2");
      const payload = await fetchJson(url.toString(), {
        headers: {
          "User-Agent": WIKIMEDIA_USER_AGENT,
          "Api-User-Agent": WIKIMEDIA_USER_AGENT,
        },
      }) as {
        query?: {
          pages?: Array<{
            pageid?: number;
            title?: string;
            extract?: string;
            touched?: string;
            fullurl?: string;
            index?: number;
          }>;
        };
      };
      return (payload.query?.pages || []).sort((left, right) => (left.index || 999) - (right.index || 999));
    }));
    const rows = variantRows.flat();
    if (!rows.length) continue;
    return rows.flatMap((item, index): InternetSearchResult[] => {
      const result = makeResult("wikimedia", index, {
        title: item.title,
        url: item.fullurl || (item.pageid ? `https://${host}/?curid=${item.pageid}` : ""),
        snippet: item.extract,
        score: Math.max(0.4, 0.96 - index * 0.035),
        publishedAt: item.touched,
      });
      if (!result || !item.pageid) return [];
      return [{ ...result, id: `web_wikimedia_${item.pageid}` }];
    });
  }
  return [];
}

const PROVIDER_ADAPTERS: Record<InternetSearchProvider, ProviderAdapter> = {
  tavily: {
    id: "tavily",
    configured: (runtime) => Boolean(runtime.TAVILY_API_KEY?.trim()),
    search: tavilySearch,
  },
  exa: {
    id: "exa",
    configured: (runtime) => Boolean(runtime.EXA_API_KEY?.trim()),
    search: exaSearch,
  },
  google: {
    id: "google",
    configured: (runtime) => Boolean(runtime.GOOGLE_SEARCH_API_KEY?.trim() && runtime.GOOGLE_SEARCH_ENGINE_ID?.trim()),
    search: googleSearch,
  },
  naver: {
    id: "naver",
    configured: (runtime) => Boolean(runtime.NAVER_API_HUB_CLIENT_ID?.trim() && runtime.NAVER_API_HUB_CLIENT_SECRET?.trim()),
    search: naverSearch,
  },
  youtube: {
    id: "youtube",
    configured: (runtime) => Boolean(runtime.YOUTUBE_API_KEY?.trim() || runtime.GOOGLE_SEARCH_API_KEY?.trim()),
    search: youtubeSearch,
  },
  brave: {
    id: "brave",
    configured: (runtime) => Boolean(runtime.BRAVE_SEARCH_API_KEY?.trim()),
    search: braveSearch,
  },
  webpilot: {
    id: "webpilot",
    configured: (runtime) => Boolean(runtime.WEBPILOT_API_URL?.trim() && runtime.WEBPILOT_API_KEY?.trim()),
    search: webpilotSearch,
  },
  duckduckgo: {
    id: "duckduckgo",
    configured: () => true,
    search: (query, limit) => duckduckgoSearch(query, limit),
  },
  jina: {
    id: "jina",
    configured: () => true,
    search: (query, limit, runtime) => jinaSearch(query, limit, runtime),
  },
  wikimedia: {
    id: "wikimedia",
    configured: () => true,
    search: (query, limit) => wikimediaSearch(query, limit),
  },
};

function providerOrder(runtime: RuntimeEnv) {
  const configuredOrder = (runtime.INTERNET_SEARCH_PROVIDER_ORDER || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is InternetSearchProvider => item in PROVIDER_ADAPTERS && item !== "wikimedia");
  return [...new Set([...configuredOrder, ...DEFAULT_PROVIDER_ORDER])].filter((providerId) => providerId !== "wikimedia");
}

/**
 * 한 배치에서 동시에 부르는 Provider 수 상한.
 *
 * 예전에는 Provider 를 하나씩 순서대로 불러 결과가 충분해지면 그 자리에서
 * 멈췄다 — 실질적으로 매 요청이 1개 소스에서만 답을 받았다는 뜻이다("정확하고
 * 다양한 정보"와는 거리가 멀다). 그렇다고 구성된 Provider 전부를 매번 병렬로
 * 부르면 상용 검색 API 비용과 레이트리밋이 요청마다 무한정 늘어난다.
 * 배치 크기를 상한으로 묶어 두 극단 사이에서 다양성과 비용을 함께 잡는다.
 */
const MAX_PARALLEL_PROVIDERS = 3;

async function runProviderBatch(
  providerIds: InternetSearchProvider[],
  plan: InternetSearchPlan,
  limit: number,
  runtime: RuntimeEnv,
) {
  return Promise.all(providerIds.map(async (providerId) => {
    const adapter = PROVIDER_ADAPTERS[providerId];
    const startedAt = Date.now();
    try {
      const providerResults: InternetSearchResult[] = [];
      for (const query of plan.queries) {
        providerResults.push(...await adapter.search(query, limit, runtime));
        if (!plan.latestRequired && rerankResults(plan.searchQuery, providerResults, limit, plan.freshness).length >= Math.min(4, limit)) break;
      }
      const deduplicated = rerankResults(plan.searchQuery, providerResults, limit, plan.freshness);
      return {
        providerId,
        results: deduplicated,
        attempt: {
          provider: providerId,
          status: deduplicated.length ? "success" : "empty",
          resultCount: deduplicated.length,
          latencyMs: Date.now() - startedAt,
          detail: deduplicated.length ? "검색 결과 수집 완료" : "검색 결과 없음",
        } satisfies InternetSearchAttempt,
      };
    } catch (error) {
      return {
        providerId,
        results: [] as InternetSearchResult[],
        attempt: {
          provider: providerId,
          status: "failed",
          resultCount: 0,
          latencyMs: Date.now() - startedAt,
          detail: error instanceof Error ? error.message : `${providerId}_search_failed`,
        } satisfies InternetSearchAttempt,
      };
    }
  }));
}

async function executeInternetSearch(plan: InternetSearchPlan, limit: number) {
  const runtime = getRuntimeEnv();
  const attempts: InternetSearchAttempt[] = [];
  const collected: InternetSearchResult[] = [];
  const successfulProviders: InternetSearchProvider[] = [];
  const minimumResults = Math.min(4, limit);

  const configuredOrder = providerOrder(runtime).filter((providerId) => {
    const configured = PROVIDER_ADAPTERS[providerId].configured(runtime);
    if (!configured) {
      attempts.push({
        provider: providerId,
        status: "skipped",
        resultCount: 0,
        latencyMs: 0,
        detail: `${PROVIDER_META[providerId].configuration} 미구성`,
      });
    }
    return configured;
  });
  const firstConfigured = configuredOrder[0];

  for (let cursor = 0; cursor < configuredOrder.length;) {
    const batch = configuredOrder.slice(cursor, cursor + MAX_PARALLEL_PROVIDERS);
    cursor += batch.length;
    const batchResults = await runProviderBatch(batch, plan, limit, runtime);
    for (const { providerId, results, attempt } of batchResults) {
      attempts.push(attempt);
      collected.push(...results);
      if (results.length) successfulProviders.push(providerId);
    }
    if (rerankResults(plan.searchQuery, collected, limit, plan.freshness).length >= minimumResults) break;
  }

  const results = companyClaimEligibleResults(plan.searchQuery, rerankResults(plan.searchQuery, collected, limit, plan.freshness));
  // 실제로 최종 결과에 살아남은 출처만 "사용됨"으로 센다 — 응답은 왔지만
  // 중복·저관련으로 rerankResults 에서 전부 걸러진 Provider 는 제외한다.
  const providersUsed = [...new Set(results.map(providerOfResult).filter((id): id is InternetSearchProvider => Boolean(id)))];
  const provider = providersUsed[0] || successfulProviders[0] || "duckduckgo";
  return {
    provider,
    providersUsed: providersUsed.length ? providersUsed : successfulProviders,
    results,
    providerPath: attempts,
    fallbackUsed: Boolean(firstConfigured && provider !== firstConfigured)
      || attempts.some((attempt) => attempt.status === "failed"),
  };
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function recordTrace(input: {
  principal: Pick<Principal, "tenantId" | "department" | "email">;
  traceId: string;
  query: string;
  provider: string;
  results: InternetSearchResult[];
  latencyMs: number;
}) {
  await ensureRagSchema();
  await getD1().prepare(`INSERT INTO retrieval_traces
    (id, tenant_id, owner_email, query_hash, department, result_count, top_score, latency_ms,
      rerank_status, candidate_count, search_scope, search_provider, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'client_rerank', ?, 'internet', ?, ?)`)
    .bind(
      input.traceId,
      input.principal.tenantId,
      input.principal.email,
      await digest(input.query),
      input.principal.department,
      input.results.length,
      Math.round((input.results[0]?.score || 0) * 10_000),
      input.latencyMs,
      input.results.length,
      input.provider,
      new Date().toISOString(),
    ).run();
}

export function getInternetSearchStatus(): InternetSearchStatus {
  const runtime = getRuntimeEnv();
  const order = providerOrder(runtime);
  const providers = order.map((id, index) => ({
    ...PROVIDER_META[id],
    order: index + 1,
    configured: PROVIDER_ADAPTERS[id].configured(runtime),
  }));
  const activeProvider = providers.find((item) => item.configured)?.id || order[0];
  const fullWebConfigured = providers.some((item) => item.configured);
  return {
    configured: fullWebConfigured,
    preferredProvider: order[0],
    fallbackProvider: undefined,
    activeProvider,
    status: fullWebConfigured ? "ready" : "fallback",
    detail: fullWebConfigured
      ? `${PROVIDER_META[activeProvider].name}부터 최대 ${MAX_PARALLEL_PROVIDERS}개 공급자를 배치로 병렬 조회해 결과를 종합하고, 그래도 부족하면 다음 배치로 확장합니다.`
      : "구성된 공개 웹 검색 공급자가 없어 검색을 수행할 수 없습니다. Google·NAVER·YouTube·Tavily·Exa·Brave·DuckDuckGo·Jina를 구성하면 다양한 출처를 병렬로 조회하고 교차 검토합니다.",
    providers,
  };
}

export async function probeInternetSearch(): Promise<InternetSearchProbe> {
  const startedAt = Date.now();
  try {
    const plan = buildSearchPlan(`${COMPANY_NAME} 베어링 제조 최신 기술 동향`);
    const result = await executeInternetSearch(plan, 3);
    const status = result.results.length
      ? result.fallbackUsed ? "degraded" : "ready"
      : "failed";
    const failed = result.providerPath.filter((item) => item.status === "failed").map((item) => item.provider);
    return {
      status,
      provider: result.provider,
      latencyMs: Date.now() - startedAt,
      resultCount: result.results.length,
      fallbackUsed: result.fallbackUsed,
      providerPath: result.providerPath,
      detail: result.results.length
        ? failed.length
          ? `${failed.join(", ")} 연결 실패 후 ${PROVIDER_META[result.provider].name}(으)로 대체했습니다.`
          : result.providersUsed.length > 1
            ? `${result.providersUsed.map((id) => PROVIDER_META[id].name).join(", ")} 등 ${result.providersUsed.length}개 공급자를 종합해 결과를 구성했습니다.`
            : `${PROVIDER_META[result.provider].name} 검색 연결이 정상입니다.`
        : "검색 공급자가 결과를 반환하지 않았습니다.",
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "failed",
      provider: "duckduckgo",
      latencyMs: Date.now() - startedAt,
      resultCount: 0,
      fallbackUsed: false,
      providerPath: [],
      detail: error instanceof Error ? error.message : "인터넷 검색 연결에 실패했습니다.",
      checkedAt: new Date().toISOString(),
    };
  }
}

export async function searchInternet(
  query: string,
  options: {
    principal: Pick<Principal, "tenantId" | "department" | "email">;
    traceId: string;
    limit?: number;
    context?: string[];
  },
): Promise<InternetSearchResponse> {
  const cleanQuery = query.trim();
  if (cleanQuery.length < 2 || cleanQuery.length > 2_000) {
    throw new RagError("검색어는 2~2,000자여야 합니다.", 400, "INVALID_QUERY");
  }
  const startedAt = Date.now();
  const limit = Math.min(Math.max(options.limit || 8, 1), 10);
  const plan = buildSearchPlan(cleanQuery, options.context);
  let execution: Awaited<ReturnType<typeof executeInternetSearch>>;
  try {
    execution = await executeInternetSearch(plan, limit);
  } catch {
    throw new RagError(
      "인터넷 검색 공급자가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.",
      503,
      "INTERNET_SEARCH_UNAVAILABLE",
    );
  }
  if (!execution.results.length) {
    if (isCompanyIdentityQuery(plan.searchQuery)) {
      throw new RagError(
        `${COMPANY_NAME} 관련 사실을 확인할 승인 출처가 없습니다. 공식 관계 확인 불가로 처리합니다.`,
        404,
        "INTERNET_SEARCH_COMPANY_SOURCE_UNVERIFIED",
      );
    }
    throw new RagError(
      "검증 가능한 웹 검색 결과를 찾지 못했습니다. 질문의 핵심어를 더 구체적으로 입력해 주세요.",
      404,
      "INTERNET_SEARCH_NO_RESULTS",
    );
  }
  const latencyMs = Date.now() - startedAt;
  await recordTrace({
    principal: options.principal,
    traceId: options.traceId,
    query: cleanQuery,
    provider: execution.provider,
    results: execution.results,
    latencyMs,
  }).catch(() => undefined);
  return {
    query: cleanQuery,
    searchQuery: plan.searchQuery,
    provider: execution.provider,
    providersUsed: execution.providersUsed,
    results: execution.results,
    latencyMs,
    traceId: options.traceId,
    fallbackUsed: execution.fallbackUsed,
    plan,
    providerPath: execution.providerPath,
    quality: {
      mode: "full-web",
      uniqueDomains: new Set(execution.results.map((result) => result.source)).size,
      enrichedResults: execution.results.filter((result) => result.snippet.length >= 240).length,
      freshnessApplied: Boolean(plan.freshness),
      datedResults: execution.results.filter((result) => Boolean(result.publishedAt)).length,
      asOf: plan.asOf,
    },
  };
}
