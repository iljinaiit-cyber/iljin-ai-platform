import { createFeedbackPost, listFeedbackPosts } from "../../../../lib/feedback-board";
import { enforceRateLimit } from "../../../../lib/guardrails";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const category = new URL(request.url).searchParams.get("category") || undefined;
    return ok({ items: await listFeedbackPosts(principal, category) }, traceId);
  } catch (error) {
    return fail(error, traceId);
  }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await enforceRateLimit(principal, "feedback.create", 10);
    const body = await request.json() as { category?: unknown; title?: unknown; content?: unknown; isNotice?: unknown };
    return ok({ item: await createFeedbackPost(principal, body) }, traceId, { status: 201 });
  } catch (error) {
    return fail(error, traceId);
  }
}
