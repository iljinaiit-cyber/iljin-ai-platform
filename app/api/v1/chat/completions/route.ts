import { completeWithRag, RagError, type WebRagCitation } from "../../../../../lib/rag";
import { completeWithGateway, type GatewaySensitivity } from "../../../../../lib/llm-gateway";
import {
  conversationContext,
  getConversationAttachmentAssetIds,
  maybeSummarizeConversation,
  recordExchange,
} from "../../../../../lib/conversations";
import { loadUserPreferences, updateUserPreferencesFromRequest } from "../../../../../lib/user-memory";
import { getConversationSensitivity, recordLlmInvocation } from "../../../../../lib/llm-telemetry";
import { searchInternet, type InternetSearchResponse } from "../../../../../lib/internet-search";
import { answerOutputTokenBudget, answerPreferenceInstruction, answerReasoningTier } from "../../../../../lib/answer-format";
import { extractRelatedQuestions, RELATED_QUESTION_INSTRUCTION, type FollowUpQuestion } from "../../../../../lib/question-rewriter";
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
};

const sse = (event: string, data: unknown) =>
  new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

const INTERNET_GROUNDING_MESSAGE_LIMIT = 7_900;
const INTERNET_GROUNDING_SOURCE_LIMIT = 6;
const INTERNET_CONVERSATION_CONTEXT_BUDGET = 1_200;

function maxOutputTokensFor(length: Body["answer_length"]) {
  return answerOutputTokenBudget(length);
}

function responsePreferenceInstruction(length: Body["answer_length"], format: Body["answer_format"]) {
  return answerPreferenceInstruction(length, format);
}

function boundedSourceContext(result: InternetSearchResponse, budget: number) {
  return result.results.slice(0, INTERNET_GROUNDING_SOURCE_LIMIT).map((item, index) =>
    `[W${index + 1}] ${item.title}\n출처: ${item.source} (${item.sourceCategoryLabel})\nURL: ${item.url}\n게시일: ${item.publishedAt || "미확인"}\n${item.snippet}`,
  ).join("\n\n").slice(0, Math.max(800, budget));
}

function buildInternetGroundingPrompt(query: string, webSearch: InternetSearchResponse, preference: string, maxLength = INTERNET_GROUNDING_MESSAGE_LIMIT) {
  const today = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" }).format(new Date());
  const instruction = `현재 날짜(대한민국): ${today}\n검색 결과는 최신 사실을 확인하기 위한 참고 근거입니다. 최종 답변은 LLM이 질문의 의도와 검색 근거를 종합해 직접 작성하세요. 검색 결과의 문장·제목을 그대로 복사하거나 검색 결과 목록을 답변처럼 나열하지 마세요. 검색 근거로 확인 가능한 사실만 단정하고, 각 핵심 주장 뒤에 [W1] 형식으로 인용하세요. 최신 게시·갱신일을 우선하고 날짜를 확인할 수 없으면 명시하세요. Wikimedia/Wikipedia는 다른 출처가 없을 때만 보조 배경지식으로 사용하고, 그 한계를 밝혀야 합니다.\n${preference}${RELATED_QUESTION_INSTRUCTION}\n\n검색 근거:\n`;
  const question = `\n\n질문:\n${query}`;
  const sourceBudget = maxLength - instruction.length - question.length;
  return `${instruction}${boundedSourceContext(webSearch, sourceBudget)}${question}`;
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

function ensureInternetCitationCoverage(content: string, citations: WebRagCitation[]) {
  if (!citations.length || /\[W\d+\]/.test(content)) return content;
  return `${content}\n\n## 참고 출처\n${citations.map((citation) => `- [${citation.id}] ${citation.title}`).join("\n")}`;
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

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "ai.chat", "ai.chat");
    assertAiKindEnabled("chat");
    // 순간 폭주(분당)와 누적 소진(일일)은 다른 문제다. 둘 다 건다.
    await enforceRateLimit(principal, "chat.completions", 30);
    await enforceDailyBudget(principal, "chat");
    const body = await request.json() as Body;
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
    const storedPreferences = await loadUserPreferences(principal).catch(
      () => ({} as Awaited<ReturnType<typeof loadUserPreferences>>),
    );
    const answerLength = body.summary_only ? "brief" : body.answer_length ?? storedPreferences.answerLength ?? "standard";
    const answerFormat = body.answer_format ?? storedPreferences.answerFormat ?? "paragraph";
    const reasoningTier = body.reasoning_tier === "swift" || body.reasoning_tier === "expert" || body.reasoning_tier === "deep"
      ? body.reasoning_tier
      : answerReasoningTier(answerLength);
    const preference = `${responsePreferenceInstruction(answerLength, answerFormat)}${body.summary_only ? "\n첫 줄에 질문에 대한 한 문장 요약만 작성하고, 추가 설명은 작성하지 마세요." : ""}`;
    const userContent = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
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
    const searchMode = body.search_mode ?? storedPreferences.searchScope;
    if (searchMode === "internet") {
      try {
        const webSearch = await searchInternet(userContent, { principal, traceId, limit: INTERNET_GROUNDING_SOURCE_LIMIT });
        completion = await completeWithGateway(
          [{ role: "user", content: buildConversationAwareInternetPrompt(userContent, webSearch, preference, contextMessages.slice(0, -1)) }],
          traceId,
          { sensitivity, maxOutputTokens: maxOutputTokensFor(answerLength) },
          reasoningTier,
        );
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
        completion.content = ensureInternetCitationCoverage(completion.content, citations);
        internetGrounded = true;
        console.info(JSON.stringify({ event: "internet-grounded", traceId, providersUsed: webSearch.providersUsed, providerPath: webSearch.providerPath }));
      } catch (error) {
        if (!(error instanceof RagError) || !["INTERNET_SEARCH_UNAVAILABLE", "INTERNET_SEARCH_NO_RESULTS"].includes(error.code)) throw error;
        completion = await completeWithGateway(
          [...contextMessages, {
            role: "user",
            content: `${userContent}\n\n${preference}\n\n실시간 웹 검색 결과를 가져올 수 없습니다. 최신 사실이라고 단정하지 말고, 일반 지식 범위에서 답변한 뒤 필요한 경우 사용자가 재검색할 수 있도록 안내하세요.`,
          }],
          traceId,
          { sensitivity, maxOutputTokens: maxOutputTokensFor(answerLength) },
          reasoningTier,
        );
        citations = [];
        console.warn(JSON.stringify({ event: "internet-search-fallback", traceId, code: error.code }));
      }
    } else {
      const ragResult = await completeWithRag({
        messages: contextMessages,
        principal,
        traceId,
        providerPolicy: { sensitivity, maxOutputTokens: maxOutputTokensFor(answerLength) },
        responsePreferences: { length: answerLength, format: answerFormat },
          reasoningTier,
        assetIds: attachmentAssetIds.length ? attachmentAssetIds : undefined,
      });
      completion = ragResult.completion;
      citations = ragResult.search.citations;
      followUpQuestions = ragResult.followUpQuestions;
    }
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
      usage: completion.usage,
      follow_up_questions: followUpQuestions,
      related_questions: relatedQuestions,
    };

    if (!body.stream) {
      return ok({ ...done, content: completion.content, citations }, traceId);
    }

    // completeWithRag 는 완성된 답변을 돌려준다. 실시간 토큰 스트림이 아니라
    // 사후 분할 전송이다(06 GAP-04). 프런트 계약(stage/delta/citation/done)은
    // 동일하므로 Provider 실시간 스트림으로 바꿔도 이 라우트만 고치면 된다.
    // ponytail: 사후 분할, 상한 = 첫 토큰까지 전체 생성 대기. passthrough 로 이관 예정.
    const stream = new ReadableStream({
      async start(controller) {
        const { summary, remainder } = splitStreamingAnswer(completion.content ?? "");
        controller.enqueue(sse("stage", { stage: "답변 요약 준비 중", tokens: completion.usage?.completion_tokens }));
        if (summary) controller.enqueue(sse("summary", { text: summary }));
        if (summary) await new Promise((resolve) => setTimeout(resolve, 120));
        controller.enqueue(sse("stage", { stage: "상세 답변 생성 중", tokens: completion.usage?.completion_tokens }));
        for (const citation of citations) controller.enqueue(sse("citation", citation));
        const text = summary ? remainder : completion.content ?? "";
        for (let i = 0; i < text.length; i += 48) {
          controller.enqueue(sse("delta", { text: text.slice(i, i + 48) }));
        }
        controller.enqueue(sse("done", done));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Trace-Id": traceId,
        "X-LLM-Provider": completion.provider,
      },
    });
  } catch (error) {
    return fail(error, traceId);
  }
}
