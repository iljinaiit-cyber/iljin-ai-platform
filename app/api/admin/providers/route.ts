import { listProviderProbes, recordProviderProbe } from "../../../../lib/provider-resources";
import { resolvePrincipal, requireRole } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const p = await resolvePrincipal(request); requireRole(p, ["admin"]);
    return ok({ probes: await listProviderProbes(p.tenantId) }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const p = await resolvePrincipal(request); requireRole(p, ["admin"]);
    const body = await request.json() as {
      provider?: Parameters<typeof recordProviderProbe>[1];
      probe?: Parameters<typeof recordProviderProbe>[2];
    };
    if (!body.provider || !body.probe) {
      return ok({ error: { code: "INVALID_INPUT", message: "provider 와 probe 가 필요합니다.", trace_id: traceId } }, traceId, { status: 400 });
    }
    return ok(await recordProviderProbe(p, body.provider, body.probe), traceId, { status: 201 });
  } catch (error) { return fail(error, traceId); }
}
