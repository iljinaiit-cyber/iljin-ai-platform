import { synthesizeSpeech } from "../../../../../lib/multimodal-output";
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
    assertAiKindEnabled("tts");
    await enforceRateLimit(principal, "chat.tts", 20);
    await enforceDailyBudget(principal, "tts");
    const body = await request.json() as { text?: string };
    const text = body.text ?? "";
    // TTS 비용은 입력 길이에 비례한다. 길이 상한이 곧 1회 비용 상한이다.
    inspectUserInput(text);
    return ok({ audio: await synthesizeSpeech(text) }, traceId);
  } catch (error) { return fail(error, traceId); }
}
