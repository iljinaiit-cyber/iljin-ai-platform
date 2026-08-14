import { completeWithRag, RagError, type WebRagCitation } from "../../../../../lib/rag";
import { completeWithGateway, mergeCompletionUsage, type GatewayCompletion, type GatewaySensitivity } from "../../../../../lib/llm-gateway";
import {
  conversationContext,
  getConversationAttachmentAssetIds,
  maybeSummarizeConversation,
  recordExchange,
} from "../../../../../lib/conversations";
import { buildFeedbackLearningContext, loadUserPreferences, updateUserPreferencesFromRequest } from "../../../../../lib/user-memory";
import { getEffectiveModel } from "../../../../../lib/llm-model-config";
import { getConversationSensitivity, recordLlmInvocation } from "../../../../../lib/llm-telemetry";
import { searchInternet, type InternetSearchResponse } from "../../../../../lib/internet-search";
import { answerOutputTokenBudget, answerPreferenceInstruction, answerReasoningTier, inferAnswerFormat, isResearchQuery } from "../../../../../lib/answer-format";
import { extractFollowUpQuestions, extractRelatedQuestions, generateInsufficiencyQuestions, RELATED_QUESTION_INSTRUCTION, rewriteQuery, type FollowUpQuestion } from "../../../../../lib/question-rewriter";
import { resolvePrincipal } from "../../../../../lib/identity";
import { authorizeFeature } from "../../../../../lib/admin-governance";
import {
  GuardrailError,
  assertAiKindEnabled,
  enforceDailyBudget,
  enforceRateLimit,
  inspectUserInput,
} from "../../../../../lib/guardrails";
import { fail, newTraceId, ok } from "../../../_shared";
import { registerWorkItemFromText } from "../../../../../lib/schedule-planning";
import { createScheduledTask, isValidCronExpression, parseNaturalLanguageSchedule } from "../../../../../lib/scheduled-tasks";
import { chatAgentContext, getChatAgent } from "../../../../../lib/chat-agents";

type Body = {
  messages?: Array<{ role: string; content: string }>;
  sensitivity?: "public" | "internal" | "confidential";
  rag?: boolean;
  search_mode?: string;
  answer_length?: "brief" | "standard" | "detailed";
  answer_format?: "paragraph" | "bullets" | "table";
  reasoning_tier?: string;
  stream?: boolean;
  summary_only?: boolean;
  conversation_id?: string;
  agent_id?: string;
};

const sse = (event: string, data: unknown) =>
  new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

const CLARIFICATION_LEAD_IN = "권한 범위에서 확인 가능한 근거만으로는 답변하기 부족합니다. 최종 답변을 생성하기 전에 확인이 필요한 정보에 아래에서 답해 주세요.";
const COLD_START_CLARIFICATION_LEAD_IN = "현재 질문과 대화 맥락만으로는 정확한 답변에 필요한 정보가 부족합니다. 임의로 추정하지 않고, 아래 선택 질문으로 범위를 먼저 확인해 주세요.";
const INTERNET_GROUNDING_MESSAGE_LIMIT = 7_900;
const INTERNET_GROUNDING_SOURCE_LIMIT = 6;
const INTERNET_CONVERSATION_CONTEXT_BUDGET = 1_200;
const MIN_DETAILED_INTERNET_BODY_CHARACTERS = 1_000;
const INTERNET_LINK_INSTRUCTION = "Only use URLs present in the supplied search evidence. Never invent example, guessed, or generalized URLs; if a source URL is not verified, show the source title without a link.";

function needsColdStartClarification(query: string, previousMessages: Array<{ role: string; content: string }>, webSearch?: InternetSearchResponse) {
  if (previousMessages.some((message) => message.role === "user" || message.role === "assistant")) return false;
  const normalized = query.trim().replace(/\s+/g, " ");
  const tokenCount = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean).length;
  const contextReference = /^(이거|그거|그것|이것|여기|저기|방금|앞서|이전|해당)|\b(이거|그거|그것|이것|여기|저기|방금|앞서|이전|해당)\b/.test(normalized);
  const lowEvidence = !webSearch || webSearch.results.length < 2 || webSearch.quality.uniqueDomains < 2;
  return lowEvidence && (contextReference || normalized.length < 12 || tokenCount <= 2);
}

function defaultClarificationQuestions(): FollowUpQuestion[] {
  return [
    { question: "어떤 대상·제품·조직을 말씀하시나요?", intent: "대상 명확화" },
    { question: "원하시는 범위는 최신 동향, 비교·검토, 실행 방법 중 무엇인가요?", intent: "목적 명확화" },
    { question: "답변 기준이 되는 기간·지역·조건이 있나요?", intent: "범위와 기준 명확화" },
  ];
}

// answer_length and reasoning_tier are independent request fields (AgentPortal
// derives one from the other, but the API also accepts reasoning_tier on its own).
// A deep tier explicitly requested on top of a shorter length still needs room for
// its 8-section structure, so the length budget alone isn't enough.
function maxOutputTokensFor(length: Body["answer_length"], tier: "swift" | "expert" | "deep" = "expert") {
  const tierBoost = tier === "deep" ? 1.5 : tier === "swift" ? 0.5 : 1;
  return Math.round(answerOutputTokenBudget(length) * tierBoost);
}

function responsePreferenceInstruction(length: Body["answer_length"], format: Body["answer_format"], query = "") {
  return answerPreferenceInstruction(length, format, query);
}

function boundedSourceContext(result: InternetSearchResponse, budget: number) {
  return result.results.slice(0, INTERNET_GROUNDING_SOURCE_LIMIT).map((item, index) =>
    `[W${index + 1}] ${item.title}\n출처: ${item.source} (${item.sourceCategoryLabel})\nURL: ${item.url}\n게시일: ${item.publishedAt || "미확인"}\n${item.snippet}`,
  ).join("\n\n").slice(0, Math.max(800, budget));
}

function buildInternetGroundingPrompt(query: string, webSearch: InternetSearchResponse, preference: string, maxLength = INTERNET_GROUNDING_MESSAGE_LIMIT) {
  const today = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" }).format(new Date());
  const researchFrame = webSearch.plan.intent === "research"
    ? `\n조사 설계: 이 질문은 단일 사실 조회가 아닌 리서치·벤치마킹 요청입니다. 검색 결과를 글로벌 통계, 국내 정책·도입 현황, 기업별 실행 사례, 제조·산업 유즈케이스, ROI·리스크 근거로 묶어 비교하세요. 한 출처의 주장만으로 시장 전체를 일반화하지 말고, 조사기관·표본·조사시점·수치 정의를 함께 기록하세요. 정부 목표치·기업 발표 자기보고·독립 조사 실측·컨설팅 전망을 서로 다른 증거 등급으로 구분하세요. 기업 사례는 회사명·업무 대상·조직/플랫폼·투자 또는 규모·공개 성과·시점을 빠뜨리지 말고, 수치가 없으면 정량 성과 미공개라고 명시하세요.\n`
    : "";
  const instruction = `현재 날짜(대한민국): ${today}\n검색 의도: ${webSearch.plan.intent} · 검색 질의: ${webSearch.plan.searchQuery} · 조사 변형: ${webSearch.plan.queries.join(" | ")}\n검색 결과는 최신 사실을 확인하기 위한 참고 근거입니다. 최종 답변은 LLM이 질문의 의도와 검색 근거를 종합해 직접 작성하세요. 먼저 가능한 범위에서 서로 다른 공급자·도메인의 출처를 여러 개 조사하고, 공식·정부·학술·전문 매체 등 신뢰도 높은 근거를 우선해 교차 검토하세요. 출처의 최신성·직접성·신뢰도를 비교하고, 서로 충돌하는 내용은 양쪽을 구분해 설명하세요. 검색 결과의 문장·제목을 그대로 복사하거나 검색 결과 목록을 답변처럼 나열하지 마세요. 검색 근거로 확인 가능한 사실만 단정하고, 각 핵심 주장 뒤에 [W1] 형식으로 인용하세요. 최신 게시·갱신일을 우선하고 날짜를 확인할 수 없으면 명시하세요. 출처가 하나뿐이거나 근거가 부족하면 그 한계를 밝히고 [확인 필요]로 표시하세요.${researchFrame}\n${preference}${RELATED_QUESTION_INSTRUCTION}\n\n검색 근거:\n`;
  const question = `\n\n질문:\n${query}`;
  const sourceBudget = maxLength - instruction.length - INTERNET_LINK_INSTRUCTION.length - question.length;
  return `${INTERNET_LINK_INSTRUCTION}\n${instruction}${boundedSourceContext(webSearch, sourceBudget)}${question}`;
}

function buildConversationAwareInternetPrompt(
  query: string,
  webSearch: InternetSearchResponse,
  preference: string,
  previousMessages: Array<{ role: string; content: string }>,
) {
  const context = previousMessages.slice(-6).map((message) => `${message.role}: ${message.content}`).join("\n").slice(-INTERNET_CONVERSATION_CONTEXT_BUDGET);
  const contextPrefix = context ? `이전 대화 맥락:\n${context}\n\n` : "";
  const basePrompt = buildInternetGroundingPrompt(query, webSearch, preference, INTERNET_GROUNDING_MESSAGE_LIMIT - contextPrefix.length);
  return `${contextPrefix}${basePrompt}`;
}

function canonicalHttpUrl(value: string) {
  try {
    const url = new URL(value.trim().replace(/[.,!?;:]+$/g, ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function sanitizeInternetLinks(content: string, citations: WebRagCitation[]) {
  const trustedUrls = new Map<string, string>();
  for (const citation of citations) {
    const canonical = canonicalHttpUrl(citation.url);
    if (canonical) trustedUrls.set(canonical, citation.url);
  }

  const linkedContent = content.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label: string, rawUrl: string) => {
    const trustedUrl = trustedUrls.get(canonicalHttpUrl(rawUrl) || "");
    return trustedUrl ? `[${label}](${trustedUrl})` : label;
  });
  return linkedContent.replace(/https?:\/\/[^\s<)]+/g, (rawUrl) => trustedUrls.get(canonicalHttpUrl(rawUrl) || "") || "");
}

function ensureInternetCitationCoverage(content: string, citations: WebRagCitation[]) {
  if (!citations.length || /\[W\d+\]/.test(content)) return content;
  return `${content}\n\n## 참고 출처\n${citations.map((citation) => `- [${citation.id}] ${citation.title}`).join("\n")}`;
}

function ensureDeepInternetSourceSection(content: string, citations: WebRagCitation[], length: Body["answer_length"]) {
  const sanitizedContent = sanitizeInternetLinks(content, citations);
  if (length !== "detailed" || !citations.length) return sanitizedContent;
  const withoutUnverifiedSourceSection = sanitizedContent
    .replace(/(?:^|\n)\s*(?:(?:#{1,6}\s*)|(?:\d+[.)]\s+))?(?:참고|출처)[^\n]*\n[\s\S]*$/im, "")
    .trim();
  return `${withoutUnverifiedSourceSection}\n\n## 참고한 정보 출처 및 링크\n${citations.map((citation) => `- [${citation.id}] [${citation.title}](${citation.url}) · ${citation.source}${citation.publishedAt ? ` · ${citation.publishedAt}` : ""}`).join("\n")}`;
}

function needsDetailedInternetExpansion(content: string) {
  const answerOnly = content.replace(/##\s*연관\s*질문[\s\S]*$/i, "").trim();
  const sectionCount = (answerOnly.match(/^##\s+/gm) || []).length;
  return answerOnly.length < MIN_DETAILED_INTERNET_BODY_CHARACTERS || sectionCount < 3;
}

async function expandShallowDetailedInternetAnswer(
  completion: GatewayCompletion,
  prompt: string,
  traceId: string,
  sensitivity: GatewaySensitivity,
  reasoningTier: "swift" | "expert" | "deep",
  cloudflareModelOverride?: string,
) {
  if (!needsDetailedInternetExpansion(completion.content)) return completion;

  try {
    const expanded = await completeWithGateway(
      [
        { role: "user", content: prompt },
        { role: "assistant", content: completion.content },
        { role: "user", content: "방금 답변은 심층 요청에 비해 너무 짧거나 구조가 부족합니다. 이전 답변을 요약·반복하지 말고, 제공된 검색 근거만 사용해 전체 답변을 다시 작성하세요. '## 개요 및 핵심 요약', '## 상세 분석 내용', '## 주요 데이터 및 인사이트', '## 참고한 정보 출처 및 링크'를 포함하고, 핵심 주장에는 [W1] 형식의 인용을 붙이세요. 근거가 부족한 항목은 [확인 필요]로 표시하세요." },
      ],
      `${traceId}-depth-repair`,
      { sensitivity, maxOutputTokens: maxOutputTokensFor("detailed", reasoningTier), cloudflareModelOverride },
      reasoningTier,
    );
    if (expanded.content.trim().length <= completion.content.trim().length) return completion;
    console.info(JSON.stringify({ event: "internet-detailed-answer-repaired", traceId, beforeChars: completion.content.length, afterChars: expanded.content.length }));
    return {
      ...expanded,
      traceId: completion.traceId,
      latencyMs: completion.latencyMs + expanded.latencyMs,
      usage: mergeCompletionUsage(completion, expanded),
    };
  } catch (error) {
    console.warn("[chat] detailed internet answer repair failed", { traceId, error: error instanceof Error ? error.message : String(error) });
    return completion;
  }
}

function ensureReferenceDateHeader(content: string) {
  if (/^> 기준일:/m.test(content)) return content;
  const date = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" }).format(new Date());
  return `> 기준일: ${date} · 검색 및 접근 가능 문서의 최신 확인 버전 기준\n\n${content}`;
}

function splitStreamingAnswer(content: string) {
  const lines = content.trim().split(/\r?\n/);
  const summaryIndex = lines.findIndex((line) => {
    const value = line.trim();
    return value && !/^>\s*기준일:/.test(value) && !/^#{1,3}\s+/.test(value);
  });
  if (summaryIndex < 0) return { summary: "", remainder: content };
  return {
    summary: lines[summaryIndex].trim(),
    remainder: [...lines.slice(0, summaryIndex), ...lines.slice(summaryIndex + 1)].join("\n").trim(),
  };
}

function buildFallbackRelatedQuestions(query: string, webSearch: InternetSearchResponse): FollowUpQuestion[] {
  const sourceQuestions = [...new Set(webSearch.results.map((item) => item.title.trim()).filter(Boolean))]
    .slice(0, 2)
    .map((title) => ({
      question: `${title}의 핵심 내용과 근거를 더 자세히 알려줘.`,
      intent: "검색 결과 상세 확인",
    }));
  return [
    ...sourceQuestions,
    { question: `${query}와 관련된 최신 변경 사항이나 후속 영향은 무엇인가요?`, intent: "최신 동향 확인" },
  ].slice(0, 3);
}

async function resolveSensitivity(request: Request, principal: Parameters<typeof getConversationSensitivity>[0], body: Body) {
  const allowed = new Set<GatewaySensitivity>(["public", "internal", "confidential"]);
  const header = request.headers.get("X-Sensitivity") as GatewaySensitivity | null;
  const requested = body.sensitivity || (header && allowed.has(header) ? header : "internal");
  if (body.conversation_id) {
    const stored = await getConversationSensitivity(principal, body.conversation_id);
    if (stored && stored !== requested) {
      throw new GuardrailError("대화의 보안 등급은 생성 후 변경할 수 없습니다.", 409, "CONVERSATION_SENSITIVITY_MISMATCH");
    }
  }
  return requested;
}

type StageEmitter = (stage: string, details?: Record<string, unknown>) => void;

async function executeChat(request: Request, body: Body, traceId: string, emitStage?: StageEmitter) {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "ai.chat", "ai.chat");
    assertAiKindEnabled("chat");
    // 순간 폭주(분당)와 누적 소진(일일)은 다른 문제다. 둘 다 건다.
    await enforceRateLimit(principal, "chat.completions", 30);
    await enforceDailyBudget(principal, "chat");
    const rawMessages = body.messages ?? [];
    // 대화 이력 전체가 매 요청 프롬프트로 들어간다. 개수 상한이 없으면 클라이언트가
    // 이력을 부풀리는 것만으로 1회 요청 비용을 무한정 키울 수 있다.
    if (rawMessages.length > 40) {
      throw new GuardrailError("대화 이력이 너무 깁니다. 새 대화를 시작해 주세요.", 413, "PAYLOAD_TOO_LARGE");
    }
    for (const m of rawMessages) inspectUserInput(m.content ?? "");
    const messages = rawMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })) as Parameters<typeof completeWithRag>[0]["messages"];

    // 민감도는 헤더가 아니라 본문·기본값을 정본으로 쓴다. 헤더는 클라이언트가
    // 임의로 낮출 수 있으므로 신뢰 경계 밖이다 — 미상이면 internal 로 잠근다.
    const sensitivity = await resolveSensitivity(request, principal, body);
    const [storedPreferences, cloudflareModelOverride, localModelOverride] = await Promise.all([
      loadUserPreferences(principal).catch(() => ({} as Awaited<ReturnType<typeof loadUserPreferences>>)),
      // 관리자가 /admin/llm-models 에서 저장한 테넌트별 모델을 실제 호출에 반영한다.
      // 미설정이면 getEffectiveModel 이 카탈로그 기본값을 그대로 돌려주므로 항상 안전하다.
      getEffectiveModel(principal.tenantId, "chat").catch(() => undefined),
      getEffectiveModel(principal.tenantId, "chat_local").catch(() => undefined),
    ]);
    const userContent = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const selectedAgent = body.agent_id ? await getChatAgent(principal, body.agent_id) : undefined;
    const selectedAgentContext = selectedAgent ? chatAgentContext(selectedAgent) : "";
    // A research/landscape request needs enough room for evidence comparison,
    // company cases, caveats, and a business-plan takeaway. Explicit user
    // length choices still win; otherwise research questions use the detailed
    // contract automatically.
    const requestedAnswerLength = body.summary_only
      ? "brief"
      : body.answer_length ?? (isResearchQuery(userContent) ? "detailed" : storedPreferences.answerLength ?? "standard");
    // The portal sends its default "standard" value explicitly. Treat that
    // default as a deep research brief for landscape/benchmarking questions;
    // an explicit brief/summary request remains short.
    const researchDepth = !body.summary_only && requestedAnswerLength === "standard" && isResearchQuery(userContent);
    const answerLength = researchDepth ? "detailed" : requestedAnswerLength;
    const answerFormat = body.answer_format ?? inferAnswerFormat(userContent);
    const feedbackLearningContext = buildFeedbackLearningContext(storedPreferences);
    const reasoningTier = body.reasoning_tier === "swift" || body.reasoning_tier === "expert" || body.reasoning_tier === "deep"
      ? body.reasoning_tier
      : answerReasoningTier(answerLength);
    const preference = `${responsePreferenceInstruction(answerLength, answerFormat, userContent)}${body.summary_only ? "\n첫 줄에 질문에 대한 한 문장 요약만 작성하고, 추가 설명은 작성하지 마세요." : ""}`;
    const preferenceWithLearning = `${preference}${feedbackLearningContext}${selectedAgentContext}`;
    const contextMessages = body.conversation_id
      ? [
          ...(await conversationContext(principal, body.conversation_id)),
          { role: "user" as const, content: userContent },
        ]
      : messages;
    const attachmentAssetIds = body.conversation_id
      ? await getConversationAttachmentAssetIds(principal, body.conversation_id)
      : [];
    let completion;
    let citations: Awaited<ReturnType<typeof completeWithRag>>["search"]["citations"] | WebRagCitation[];
    let followUpQuestions: Awaited<ReturnType<typeof completeWithRag>>["followUpQuestions"] = [];
    let relatedQuestions: FollowUpQuestion[] = [];

    let internetGrounded = false;
    let clarificationSuggestionsOnly = false;
    const searchMode = body.search_mode ?? storedPreferences.searchScope;
    emitStage?.("질문·의도 분석 중");
    if (searchMode === "internet") {
      const priorInternetMessages = contextMessages
        .slice(0, -1)
        .filter((message) => message.role === "user" || message.role === "assistant");
      const internetContext = priorInternetMessages.map((message) => message.content).slice(-4);
      try {
        // Follow-up questions often omit the subject ("그거 최신 내용은?").
        // Rewrite only when history exists so a cold-start question does not pay
        // for an unnecessary extra model call, then give both the standalone
        // query and the raw context to the multi-provider search planner.
        emitStage?.("대화 맥락 확인 중");
        const internetQuery = priorInternetMessages.length
          ? await rewriteQuery(userContent, priorInternetMessages, traceId)
          : userContent;
        emitStage?.("웹 검색 중");
        const webSearch = await searchInternet(internetQuery, {
          principal,
          traceId,
          limit: INTERNET_GROUNDING_SOURCE_LIMIT,
          context: internetContext,
        });
        emitStage?.("검색 결과 교차 검토 중", {
          sourceCount: webSearch.results.length,
          providers: webSearch.providersUsed,
        });
        if (needsColdStartClarification(userContent, priorInternetMessages, webSearch)) {
          followUpQuestions = await generateInsufficiencyQuestions(userContent, contextMessages, traceId);
          if (!followUpQuestions.length) followUpQuestions = defaultClarificationQuestions();
          completion = {
            id: `internet-clarification-${traceId}`,
            provider: "cloudflare" as const,
            model: "question-rewriter",
            content: COLD_START_CLARIFICATION_LEAD_IN,
            finishReason: "insufficient_evidence" as const,
            traceId,
            latencyMs: 0,
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          };
          citations = [];
          clarificationSuggestionsOnly = true;
          console.info(JSON.stringify({ event: "internet-clarification-needed", traceId, reason: "cold_start_or_ambiguous_query" }));
        } else {
          const internetPrompt = buildConversationAwareInternetPrompt(userContent, webSearch, preferenceWithLearning, contextMessages.slice(0, -1));
          emitStage?.("근거 기반 답변 작성 중");
          completion = await completeWithGateway(
            [{ role: "user", content: internetPrompt }],
            traceId,
            { sensitivity, maxOutputTokens: maxOutputTokensFor(answerLength, reasoningTier), cloudflareModelOverride, localModelOverride },
            reasoningTier,
          );
          if (answerLength === "detailed" || researchDepth) {
            completion = await expandShallowDetailedInternetAnswer(completion, internetPrompt, traceId, sensitivity, reasoningTier, cloudflareModelOverride);
          }
          const related = extractRelatedQuestions(completion.content);
          relatedQuestions = related.relatedQuestions.length
            ? related.relatedQuestions.slice(0, 3)
            : buildFallbackRelatedQuestions(userContent, webSearch);
          completion.content = related.content;
          citations = webSearch.results.slice(0, INTERNET_GROUNDING_SOURCE_LIMIT).map((item, index) => ({
            id: `W${index + 1}`, assetId: item.url, segmentId: item.id, title: item.title, version: 1,
            updatedAt: item.publishedAt, excerpt: item.snippet, score: item.score, lexicalScore: item.score,
            denseScore: item.score, url: item.url, sourceType: "web" as const, source: item.source,
            publishedAt: item.publishedAt,
          }));
          completion.content = ensureDeepInternetSourceSection(ensureInternetCitationCoverage(completion.content, citations), citations, researchDepth ? "detailed" : answerLength);
          internetGrounded = true;
          console.info(JSON.stringify({ event: "internet-grounded", traceId, providersUsed: webSearch.providersUsed, providerPath: webSearch.providerPath }));
        }
      } catch (error) {
        if (!(error instanceof RagError) || !["INTERNET_SEARCH_UNAVAILABLE", "INTERNET_SEARCH_NO_RESULTS"].includes(error.code)) throw error;
        if (needsColdStartClarification(userContent, priorInternetMessages)) {
          followUpQuestions = await generateInsufficiencyQuestions(userContent, contextMessages, traceId);
          if (!followUpQuestions.length) followUpQuestions = defaultClarificationQuestions();
          completion = {
            id: `internet-clarification-${traceId}`,
            provider: "cloudflare" as const,
            model: "question-rewriter",
            content: COLD_START_CLARIFICATION_LEAD_IN,
            finishReason: "insufficient_evidence" as const,
            traceId,
            latencyMs: 0,
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          };
          citations = [];
          clarificationSuggestionsOnly = true;
          console.info(JSON.stringify({ event: "internet-clarification-needed", traceId, reason: "cold_start_without_search_results" }));
        } else {
          emitStage?.("근거 기반 답변 작성 중");
          completion = await completeWithGateway(
            [...contextMessages, {
              role: "user",
              content: `${userContent}\n\n${preferenceWithLearning}\n\n실시간 웹 검색 결과를 가져올 수 없습니다. 최신 사실이라고 단정하지 말고, 일반 지식 범위에서 답변한 뒤 필요한 경우 사용자가 재검색할 수 있도록 안내하세요.`,
            }],
            traceId,
            { sensitivity, maxOutputTokens: maxOutputTokensFor(answerLength, reasoningTier), cloudflareModelOverride, localModelOverride },
            reasoningTier,
          );
          citations = [];
          console.warn(JSON.stringify({ event: "internet-search-fallback", traceId, code: error.code }));
        }
      }
    } else {
      const ragResult = await completeWithRag({
        messages: contextMessages,
        principal,
        traceId,
        providerPolicy: { sensitivity, maxOutputTokens: maxOutputTokensFor(answerLength, reasoningTier), cloudflareModelOverride, localModelOverride },
        responsePreferences: { length: answerLength, format: answerFormat, learningContext: feedbackLearningContext },
        reasoningTier,
        contextFileBlock: selectedAgentContext,
        assetIds: attachmentAssetIds.length ? attachmentAssetIds : undefined,
        onStage: emitStage,
      });
      completion = ragResult.completion;
      citations = ragResult.search.citations;
      followUpQuestions = ragResult.followUpQuestions;
    }
    // 근거 부족(rag.ts) 뿐 아니라 정상 답변에도 프롬프트 지침에 따라 LLM이
    // 스스로 '## 보충 질문' 절을 붙일 수 있다(FOLLOW_UP_INSTRUCTION). 답변 본문에
    // 마크다운으로 남기지 않고 항상 이 지점에서 뽑아 follow_up_questions 로 합친다.
    const extractedFollowUps = extractFollowUpQuestions(completion.content);
    completion = { ...completion, content: extractedFollowUps.content };
    const allFollowUps = [...followUpQuestions, ...extractedFollowUps.followUpQuestions]
      .filter((question, index, all) => all.findIndex((other) => other.question === question.question) === index)
      .slice(0, 5);
    // rag.ts 가 finishReason: "insufficient_evidence" 로 표시하는 경우는 부분 답변이
    // 아니라 "근거가 없어 아직 답하지 않았다"는 뜻이다. AgentPortal 은 이 신호로
    // ClarificationForm(정보 제출 후 최종 답변 재요청)을 띄우고, 그 외에는 보충 질문을
    // 클릭 가능한 버튼으로만 보여준다.
    const clarificationRequired = !clarificationSuggestionsOnly && completion.finishReason === "insufficient_evidence" && allFollowUps.length > 0;
    if (clarificationRequired) completion = { ...completion, content: CLARIFICATION_LEAD_IN };
    if (internetGrounded) completion.content = ensureReferenceDateHeader(completion.content);
    await recordLlmInvocation({ principal, conversationId: body.conversation_id || "", completion, sensitivity })
      .catch((error) => console.error(`[${traceId}] recordLlmInvocation`, error));


    // 대화 저장 실패가 답변 반환을 막지 않는다. 답은 이미 생성됐다.
    const saved = body.conversation_id
      ? await recordExchange({
          principal,
          conversationId: body.conversation_id,
          userContent,
          completion,
          citations,
        }).catch((error) => {
          console.error(`[${traceId}] recordExchange`, error);
          return undefined;
        })
      : undefined;

    if (body.conversation_id && saved) {
      await maybeSummarizeConversation(principal, body.conversation_id, traceId).catch((error) => {
        console.error(`[${traceId}] maybeSummarizeConversation`, error);
      });
      const recurring = /매일|매주|매월|매달/.test(userContent) ? parseNaturalLanguageSchedule(userContent) : null;
      if (recurring && isValidCronExpression(recurring.cronExpression) && recurring.prompt.trim()) {
        await createScheduledTask(principal, recurring.prompt, recurring.cronExpression).catch((error) => {
          console.error(`[${traceId}] auto schedule registration`, error);
        });
      }
      await registerWorkItemFromText({ principal, text: userContent, sourceId: saved.userMessageId }).catch((error) => {
        console.error(`[${traceId}] auto work registration`, error);
      });
    }

    await updateUserPreferencesFromRequest(principal, {
      answerLength: body.answer_length,
      answerFormat: body.answer_format,
      searchScope: body.search_mode,
    }).catch((error) => {
      console.error(`[${traceId}] updateUserPreferencesFromRequest`, error);
    });

    const done = {
      message_id: saved?.messageId,
      conversation_id: body.conversation_id,
      trace_id: traceId,
      provider: completion.provider,
      model: completion.model,
      latency_ms: completion.latencyMs,
      finish_reason: completion.finishReason,
      usage: completion.usage,
      follow_up_questions: allFollowUps,
      related_questions: relatedQuestions,
      clarification_required: clarificationRequired,
    };

    return { done, content: completion.content, citations, provider: completion.provider };
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const body = await request.json() as Body;
    if (!body.stream) {
      const result = await executeChat(request, body, traceId);
      const done = result.done;
      const completion = { content: result.content };
      const citations = result.citations;
      return ok({ ...done, content: completion.content, citations }, traceId);
    }

    // Keep the connection open while retrieval, verification, and answer generation
    // run so the client receives the real stage instead of a timer-driven guess.
    const stream = new ReadableStream({
      start(controller) {
        void (async () => {
          try {
            const result = await executeChat(request, body, traceId, (stage, details) => {
              controller.enqueue(sse("stage", { stage, ...details }));
            });
            const done = result.done;
            const { summary, remainder } = splitStreamingAnswer(result.content ?? "");
            if (summary) controller.enqueue(sse("summary", { text: summary }));
            controller.enqueue(sse("stage", { stage: "상세 답변 생성 중", tokens: result.done.usage?.completion_tokens }));
            for (const citation of result.citations) controller.enqueue(sse("citation", citation));
            const text = summary ? remainder : result.content ?? "";
            for (let i = 0; i < text.length; i += 48) {
              controller.enqueue(sse("delta", { text: text.slice(i, i + 48) }));
            }
            controller.enqueue(sse("done", done));
          } catch (error) {
            const errorResponse = fail(error, traceId);
            const payload = await errorResponse.json().catch(() => ({})) as { error?: { message?: string } };
            controller.enqueue(sse("error", {
              message: payload.error?.message || "요청을 처리하지 못했습니다.",
              trace_id: traceId,
            }));
          } finally {
            controller.close();
          }
        })();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Trace-Id": traceId,
      },
    });
  } catch (error) {
    return fail(error, traceId);
  }
}
