import { createFeedbackPost, listFeedbackPosts } from "../../../../lib/feedback-board";
import { enforceRateLimit } from "../../../../lib/guardrails";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const searchParams = new URL(request.url).searchParams;
    const category = searchParams.get("category") || undefined;
    const page = Number(searchParams.get("page") || "1");
    const result = await listFeedbackPosts(principal, category, page);
    return ok({
      items: result.items,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
      },
      capabilities: {
        canModerate: principal.role === "admin" || principal.role === "manager",
        canNotice: principal.role === "admin",
        canEditAny: principal.role === "admin",
      },
    }, traceId);
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
