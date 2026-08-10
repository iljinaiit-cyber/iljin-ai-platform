import {
  createUserMemory,
  deleteAllUserMemories,
  listUserMemoryCandidates,
  listUserMemories,
} from "../../../../lib/user-memory";
import { assertConversationOwner } from "../../../../lib/conversations";
import { audit } from "../../../../lib/conversations";
import { loadUserPreferences, saveUserPreferences } from "../../../../lib/user-memory";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const [memories, candidates] = await Promise.all([
      listUserMemories(principal),
      listUserMemoryCandidates(principal),
    ]);
    const preferences = await loadUserPreferences(principal);
    return ok({ memories, candidates, memory_enabled: preferences.memoryEnabled !== false }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const body = await request.json().catch(() => ({})) as {
      content?: string;
      category?: string;
      conversation_id?: string;
    };
    if (!body.content?.trim()) {
      return new Response(JSON.stringify({ error: { message: "메모리 내용을 입력해 주세요." }, trace_id: traceId }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (body.conversation_id) await assertConversationOwner(principal, body.conversation_id);
    const memory = await createUserMemory(principal, {
      content: body.content,
      category: body.category,
      conversationId: body.conversation_id,
    });
    await audit({ principal, action: "memory.create", resourceType: "user_memory", resourceId: memory.id, traceId });
    return ok({ memory }, traceId, { status: 201 });
  } catch (error) { return fail(error, traceId); }
}

export async function DELETE(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await deleteAllUserMemories(principal);
    await audit({ principal, action: "memory.delete_all", resourceType: "user_memory", traceId });
    return ok({ ok: true }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function PATCH(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const body = await request.json().catch(() => ({})) as { memory_enabled?: boolean };
    if (typeof body.memory_enabled !== "boolean") {
      return new Response(JSON.stringify({ error: { message: "memory_enabled 값이 필요합니다." }, trace_id: traceId }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    await saveUserPreferences(principal, { memoryEnabled: body.memory_enabled });
    await audit({ principal, action: "memory.preferences.update", resourceType: "user_memory", traceId, details: { memoryEnabled: body.memory_enabled } });
    return ok({ memory_enabled: body.memory_enabled }, traceId);
  } catch (error) { return fail(error, traceId); }
}
