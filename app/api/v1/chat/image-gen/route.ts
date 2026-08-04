import { generateImage } from "../../../../../lib/multimodal-output";
import { resolvePrincipal } from "../../../../../lib/identity";
import { fail, newTraceId, ok } from "../../../_shared";

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    await resolvePrincipal(request);
    const body = await request.json() as { prompt?: string; model?: string };
    return ok({ image: await generateImage(body.prompt ?? "", { model: body.model }) }, traceId);
  } catch (error) { return fail(error, traceId); }
}
