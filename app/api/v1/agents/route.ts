import { createChatAgent, deleteChatAgent, listChatAgents, updateChatAgent } from "../../../../lib/chat-agents";
import { authorizeFeature } from "../../../../lib/admin-governance";
import { requireRole, resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";
import { AgentError, listTools } from "../../../../lib/agent-orchestrator";

async function validateDefaultTool(principal: Awaited<ReturnType<typeof resolvePrincipal>>, toolId?: string) {
  if (!toolId?.trim()) return;
  const tool = (await listTools(principal)).find((candidate) => candidate.id === toolId);
  if (!tool || !tool.enabled || !tool.availableToCurrentRole) throw new AgentError("기본 실행 Tool을 선택할 수 없습니다.", 400, "INVALID_DEFAULT_TOOL");
}

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
    const body = await request.json() as { name?: string; instructions?: string; default_tool_id?: string };
    await validateDefaultTool(principal, body.default_tool_id);
    return ok({ agent: await createChatAgent(principal, {
      name: body.name || "",
      instructions: body.instructions || "",
      defaultToolId: body.default_tool_id,
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
    const body = await request.json() as { id?: string; name?: string; instructions?: string; default_tool_id?: string };
    await validateDefaultTool(principal, body.default_tool_id);
    return ok({ agent: await updateChatAgent(principal, {
      id: body.id || "",
      name: body.name || "",
      instructions: body.instructions || "",
      defaultToolId: body.default_tool_id,
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
