import { completeWithRag, type WebRagCitation } from "../../../../../lib/rag";
import { completeWithGateway, type GatewaySensitivity } from "../../../../../lib/llm-gateway";
import { getConversationAttachmentAssetIds, recordExchange } from "../../../../../lib/conversations";
import { getConversationSensitivity, recordLlmInvocation } from "../../../../../lib/llm-telemetry";
import { searchInternet, type InternetSearchResponse } from "../../../../../lib/internet-search";
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

type Body = {
  messages?: Array<{ role: string; content: string }>;
  sensitivity?: "public" | "internal" | "confidential";
  rag?: boolean;
  search_mode?: string;
  answer_length?: "brief" | "standard" | "detailed";
  answer_format?: "paragraph" | "bullets" | "table";
  reasoning_tier?: string;
  stream?: boolean;
  conversation_id?: string;
};

const sse = (event: string, data: unknown) =>
  new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

const INTERNET_GROUNDING_MESSAGE_BUDGET = 7_600;
const INTERNET_GROUNDING_SOURCE_LIMIT = 6;

function maxOutputTokensFor(length: Body["answer_length"]) {
  return Math.round(4_096 * (length === "brief" ? 0.35 : length === "detailed" ? 1 : 0.65));
}

function responsePreferenceInstruction(length: Body["answer_length"], format: Body["answer_format"]) {
  const depth = length === "brief" ? "핵심만 간결하게" : length === "detailed"
    ? "핵심 결론 → 근거와 분석 → 실무적 의미 또는 실행 방안 → 리스크·한계 순서로 심층적으로"
    : "핵심 결론과 근거, 실행 방안을 포함해";
  const shape = format === "table" ? "비교 항목은 Markdown 표로" : format === "bullets" ? "소제목과 불릿으로" : "소제목과 문단으로";
  return `${depth} 답하고 ${shape} 정리하세요.`;
}

function boundedSourceContext(result: InternetSearchResponse) {
  return result.results.slice(0, INTERNET_GROUNDING_SOURCE_LIMIT).map((item, index) =>
    `[W${index + 1}] ${item.title}\nURL: ${item.url}\n게시일: ${item.publishedAt || "미확인"}\n${item.snippet}`,
  ).join("\n\n").slice(0, INTERNET_GROUNDING_MESSAGE_BUDGET);
}

function buildInternetGroundingPrompt(query: string, webSearch: InternetSearchResponse, preference: string) {
  const today = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" }).format(new Date());
  return `현재 날짜(대한민국): ${today}\n검색 결과에 있는 사실만 사용하고 각 핵심 주장 뒤에 [W1] 형식으로 인용하세요. 최신 게시·갱신일을 우선하고 날짜를 확인할 수 없으면 명시하세요.\n${preference}\n\n검색 근거:\n${boundedSourceContext(webSearch)}\n\n질문:\n${query}`;
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
    const answerLength = body.answer_length ?? "standard";
    const answerFormat = body.answer_format ?? "paragraph";
    const preference = responsePreferenceInstruction(answerLength, answerFormat);
    const userContent = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const attachmentAssetIds = body.conversation_id
      ? await getConversationAttachmentAssetIds(principal, body.conversation_id)
      : [];
    let completion;
    let citations: Awaited<ReturnType<typeof completeWithRag>>["search"]["citations"] | WebRagCitation[];
    let followUpQuestions: Awaited<ReturnType<typeof completeWithRag>>["followUpQuestions"] = [];

    if (body.search_mode === "internet") {
      const webSearch = await searchInternet(userContent, { principal, traceId, limit: INTERNET_GROUNDING_SOURCE_LIMIT });
      completion = await completeWithGateway(
        [{ role: "user", content: buildInternetGroundingPrompt(userContent, webSearch, preference) }],
        traceId,
        { sensitivity, maxOutputTokens: maxOutputTokensFor(answerLength) },
        body.reasoning_tier as Parameters<typeof completeWithRag>[0]["reasoningTier"],
      );
      citations = webSearch.results.slice(0, INTERNET_GROUNDING_SOURCE_LIMIT).map((item, index) => ({
        id: `W${index + 1}`, assetId: item.url, segmentId: item.id, title: item.title, version: 1,
        updatedAt: item.publishedAt, excerpt: item.snippet, score: item.score, lexicalScore: item.score,
        denseScore: item.score, url: item.url, sourceType: "web" as const, source: item.source,
        publishedAt: item.publishedAt,
      }));
      completion.content = ensureInternetCitationCoverage(completion.content, citations);
      console.info(JSON.stringify({ event: "internet-grounded", traceId, providerPath: webSearch.providerPath }));
    } else {
      const ragResult = await completeWithRag({
        messages,
        principal,
        traceId,
        providerPolicy: { sensitivity, maxOutputTokens: maxOutputTokensFor(answerLength) },
        responsePreferences: { length: answerLength, format: answerFormat },
        reasoningTier: body.reasoning_tier as Parameters<typeof completeWithRag>[0]["reasoningTier"],
        assetIds: attachmentAssetIds.length ? attachmentAssetIds : undefined,
      });
      completion = ragResult.completion;
      citations = ragResult.search.citations;
      followUpQuestions = ragResult.followUpQuestions;
    }
    completion.content = ensureReferenceDateHeader(completion.content);
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

    const done = {
      message_id: saved?.messageId,
      conversation_id: body.conversation_id,
      trace_id: traceId,
      provider: completion.provider,
      model: completion.model,
      latency_ms: completion.latencyMs,
      usage: completion.usage,
      follow_up_questions: followUpQuestions,
    };

    if (!body.stream) {
      return ok({ ...done, content: completion.content, citations }, traceId);
    }

    // completeWithRag 는 완성된 답변을 돌려준다. 실시간 토큰 스트림이 아니라
    // 사후 분할 전송이다(06 GAP-04). 프런트 계약(stage/delta/citation/done)은
    // 동일하므로 Provider 실시간 스트림으로 바꿔도 이 라우트만 고치면 된다.
    // ponytail: 사후 분할, 상한 = 첫 토큰까지 전체 생성 대기. passthrough 로 이관 예정.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(sse("stage", { stage: "답변 생성", tokens: completion.usage?.completion_tokens }));
        for (const citation of citations) controller.enqueue(sse("citation", citation));
        const text = completion.content ?? "";
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
