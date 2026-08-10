import { listProviderProbes, recordProviderProbe } from "../../../../lib/provider-resources";
import { resetProviderCircuit, type GatewayProvider } from "../../../../lib/llm-gateway";
import { probeCloudflareAi, probeLocalLlm } from "../../../../lib/readiness";
import { resolvePrincipal, requireRole } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const p = await resolvePrincipal(request); requireRole(p, ["admin"]);
    return ok({ probes: [...(await listProviderProbes(p.tenantId)).values()] }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const p = await resolvePrincipal(request); requireRole(p, ["admin"]);
    const body = await request.json() as {
      action?: "probe" | "probe_all" | "reset_circuit";
      provider?: Parameters<typeof recordProviderProbe>[1];
      probe?: Parameters<typeof recordProviderProbe>[2];
    };
    if (body.action === "probe_all") {
      const [cloudflare, local] = await Promise.all([probeCloudflareAi(true), probeLocalLlm()]);
      return ok({ probes: await Promise.all([
        recordProviderProbe(p, "cloudflare", cloudflare),
        recordProviderProbe(p, "local", local),
      ]) }, traceId);
    }
    if (body.action === "reset_circuit" && body.provider) {
      resetProviderCircuit(body.provider as GatewayProvider);
      return ok({ reset: body.provider }, traceId);
    }
    if (body.action === "probe" && body.provider) {
      const probe = body.provider === "cloudflare" ? await probeCloudflareAi(true) : await probeLocalLlm();
      return ok(await recordProviderProbe(p, body.provider, probe), traceId, { status: 201 });
    }
    if (!body.provider || !body.probe) {
      return ok({ error: { code: "INVALID_INPUT", message: "provider 와 probe 가 필요합니다.", trace_id: traceId } }, traceId, { status: 400 });
    }
    return ok(await recordProviderProbe(p, body.provider, body.probe), traceId, { status: 201 });
  } catch (error) { return fail(error, traceId); }
}
