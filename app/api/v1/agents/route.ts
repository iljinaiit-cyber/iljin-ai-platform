import { createChatAgent, deleteChatAgent, listChatAgents, updateChatAgent } from "../../../../lib/chat-agents";
import { authorizeFeature } from "../../../../lib/admin-governance";
import { requireRole, resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "agent.run", "agent");
    return ok({ agents: await listChatAgents(principal) }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "agent.run", "agent");
    const body = await request.json() as { name?: string; instructions?: string };
    return ok({ agent: await createChatAgent(principal, {
      name: body.name || "",
      instructions: body.instructions || "",
    }) }, traceId, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "에이전트를 생성하지 못했습니다.";
    if (message.includes("두 글자")) return Response.json({ error: { code: "INVALID_AGENT", message, trace_id: traceId } }, { status: 400 });
    return fail(error, traceId);
  }
}

export async function PATCH(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "agent.run", "agent");
    requireRole(principal, ["admin"]);
    const body = await request.json() as { id?: string; name?: string; instructions?: string };
    return ok({ agent: await updateChatAgent(principal, {
      id: body.id || "",
      name: body.name || "",
      instructions: body.instructions || "",
    }) }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function DELETE(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "agent.run", "agent");
    requireRole(principal, ["admin"]);
    const body = await request.json() as { id?: string };
    await deleteChatAgent(principal, body.id || "");
    return ok({ deleted: true }, traceId);
  } catch (error) { return fail(error, traceId); }
}
