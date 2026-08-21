import { acceptScheduleCandidate, extractScheduleCandidates, type ScheduleCandidate } from "../../../../lib/schedule-candidates";
import { authorizeFeature } from "../../../../lib/admin-governance";
import { assertAiKindEnabled, enforceRateLimit } from "../../../../lib/guardrails";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function POST(request: Request) {
    const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "ai.chat", "ai.chat");
    assertAiKindEnabled("chat");
    await enforceRateLimit(principal, "schedule.candidates", 30);
    const body = await request.json() as { message_id?: string; candidate?: ScheduleCandidate };
    if (typeof body.message_id !== "string" || !body.message_id.trim()) {
      return ok({ error: { code: "INVALID_INPUT", message: "답변 메시지 ID가 필요합니다.", trace_id: traceId } }, traceId, { status: 400 });
    }
    if (body.candidate) {
      const id = await acceptScheduleCandidate({ principal, messageId: body.message_id, candidate: body.candidate });
      return ok({ id }, traceId, { status: 201 });
    }
    return ok({ candidates: await extractScheduleCandidates({ principal, messageId: body.message_id, traceId }) }, traceId);
  } catch (error) { return fail(error, traceId); }
}
