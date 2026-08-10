import { generateImage } from "../../../../../lib/multimodal-output";
import { resolvePrincipal } from "../../../../../lib/identity";
import {
  assertAiKindEnabled,
  enforceDailyBudget,
  enforceRateLimit,
  inspectUserInput,
} from "../../../../../lib/guardrails";
import { fail, newTraceId, ok } from "../../../_shared";

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    assertAiKindEnabled("image_gen");
    // 이미지 생성은 채팅보다 훨씬 비싸다. 분당 한도를 따로 낮게 잡는다.
    await enforceRateLimit(principal, "chat.image_gen", 6);
    await enforceDailyBudget(principal, "image_gen");
    const body = await request.json() as { prompt?: string };
    const prompt = body.prompt ?? "";
    inspectUserInput(prompt);
    // 모델은 클라이언트가 고르지 못한다. 본문으로 임의 모델을 지정할 수 있으면
    // 설정으로 세운 비용 통제가 요청 한 줄로 무력화된다.
    return ok({ image: await generateImage(prompt) }, traceId);
  } catch (error) { return fail(error, traceId); }
}
