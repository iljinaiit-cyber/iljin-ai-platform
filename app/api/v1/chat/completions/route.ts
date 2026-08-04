import { completeWithRag } from "../../../../../lib/rag";
import { recordExchange } from "../../../../../lib/conversations";
import { resolvePrincipal } from "../../../../../lib/identity";
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

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const body = await request.json() as Body;
    const messages = (body.messages ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    })) as Parameters<typeof completeWithRag>[0]["messages"];

    // 민감도는 헤더가 아니라 본문·기본값을 정본으로 쓴다. 헤더는 클라이언트가
    // 임의로 낮출 수 있으므로 신뢰 경계 밖이다 — 미상이면 internal 로 잠근다.
    const sensitivity = body.sensitivity ?? "internal";

    const { completion, search, followUpQuestions } = await completeWithRag({
      messages,
      principal,
      traceId,
      providerPolicy: { sensitivity },
      responsePreferences: {
        length: body.answer_length ?? "standard",
        format: body.answer_format ?? "paragraph",
      },
      reasoningTier: body.reasoning_tier as Parameters<typeof completeWithRag>[0]["reasoningTier"],
    });

    const citations = search.citations;
    const userContent = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

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
