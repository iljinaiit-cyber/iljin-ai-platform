import { authorizeFeature } from "../../../../lib/admin-governance";
import { completeWithGateway } from "../../../../lib/llm-gateway";
import { resolvePrincipal } from "../../../../lib/identity";
import {
  GuardrailError,
  assertAiKindEnabled,
  enforceDailyBudget,
  enforceRateLimit,
  inspectUserInput,
} from "../../../../lib/guardrails";
import { fail, newTraceId, ok } from "../../_shared";

const MAX_TEXTS = 60;
const MAX_TOTAL_CHARACTERS = 7_000;

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    // 인증·인가·한도를 본문 파싱보다 먼저 통과시킨다. 이 라우트는 LLM 을 호출하므로
    // 다른 AI 라우트(chat/tts/image-gen)와 같은 가드를 지나야 한다. 종전에는 넷 다
    // 없어서 일일 예산·분당 한도를 전혀 소모하지 않고 Workers AI 를 호출할 수 있었다.
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "workspace.home", "workspace.home");
    assertAiKindEnabled("ui_translation");
    // 화면 진입 시 문구가 배치로 나가므로 채팅보다 여유를 둔다.
    await enforceRateLimit(principal, "ui.translation", 20);

    const body = await request.json() as { locale?: string; texts?: unknown };
    const locale = typeof body.locale === "string" && /^[a-z]{2,3}-[A-Z]{2}$/.test(body.locale) ? body.locale : "ko-KR";
    const texts = Array.isArray(body.texts)
      ? Array.from(new Set(body.texts.filter((text): text is string => typeof text === "string").map((text) => text.trim()).filter(Boolean))).slice(0, MAX_TEXTS)
      : [];
    // 번역할 문구가 없으면 모델을 부르지 않는다 — 예산도 차감하지 않는다.
    if (!texts.length) return ok({ translations: {} }, traceId);
    // 일반 Error 를 던지면 _shared.fail 이 내부 사정 은닉을 위해 500 으로 덮어써서
    // 이 메시지가 사라지고, 클라이언트 입력 오류가 서버 오류로 집계된다.
    if (texts.join("").length > MAX_TOTAL_CHARACTERS) {
      throw new GuardrailError("번역할 화면 문구가 너무 깁니다.", 413, "PAYLOAD_TOO_LARGE");
    }
    for (const text of texts) inspectUserInput(text);

    // 모델 호출 직전에 차감한다. 실패한 호출도 뉴런은 소모되므로 낙관적 차감이 맞다.
    await enforceDailyBudget(principal, "ui_translation");
    const completion = await completeWithGateway([
      {
        role: "user",
        content: `Translate each Korean UI string in the following JSON array into ${locale}. Return only a JSON object whose keys are the original strings and whose values are their translations. Preserve product names, email addresses, URLs, numbers, IDs, and punctuation. Do not add or omit keys.\n${JSON.stringify(texts)}`,
      },
    ], traceId, { sensitivity: "internal", maxOutputTokens: 2_400 }, "swift");
    const json = completion.content.match(/\{[\s\S]*\}/)?.[0];
    const parsed = json ? JSON.parse(json) as Record<string, unknown> : {};
    const translations = Object.fromEntries(texts.map((text) => [text, typeof parsed[text] === "string" ? parsed[text] : text]));
    return ok({ translations }, traceId);
  } catch (error) {
    return fail(error, traceId);
  }
}
