import { createScheduledTask, deleteScheduledTask, listScheduledTasks, parseNaturalLanguageSchedule, toggleScheduledTask } from "../../../../lib/scheduled-tasks";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try { return ok({ tasks: await listScheduledTasks(await resolvePrincipal(request)) }, traceId); }
  catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const body = await request.json() as { prompt?: string; cron?: string; text?: string };
    // 자연어("매일 아침 9시에 …")를 먼저 시도하고, 실패하면 명시 cron 을 쓴다.
    const parsed = body.text ? parseNaturalLanguageSchedule(body.text) : null;
    const prompt = parsed?.prompt ?? body.prompt ?? "";
    const cron = parsed?.cronExpression ?? body.cron ?? "";
    if (!prompt || !cron) {
      return ok({ error: { code: "INVALID_INPUT", message: "prompt 와 cron(또는 해석 가능한 text)이 필요합니다.", trace_id: traceId } }, traceId, { status: 400 });
    }
    return ok({ id: await createScheduledTask(principal, prompt, cron) }, traceId, { status: 201 });
  } catch (error) { return fail(error, traceId); }
}

export async function PATCH(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const body = await request.json() as { id?: string; enabled?: boolean };
    if (!body.id || typeof body.enabled !== "boolean") {
      return ok({ error: { code: "INVALID_INPUT", message: "id 와 enabled 가 필요합니다.", trace_id: traceId } }, traceId, { status: 400 });
    }
    await toggleScheduledTask(principal, body.id, body.enabled);
    return ok({ ok: true }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function DELETE(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) return ok({ error: { code: "INVALID_INPUT", message: "id 가 필요합니다.", trace_id: traceId } }, traceId, { status: 400 });
    await deleteScheduledTask(principal, id);
    return ok({ ok: true }, traceId);
  } catch (error) { return fail(error, traceId); }
}
