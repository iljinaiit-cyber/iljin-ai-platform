import { authorizeFeature } from "../../../../lib/admin-governance";
import { resolvePrincipal } from "../../../../lib/identity";
import { createMcpProfile, listMcpProfiles } from "../../../../lib/mcp-profiles";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "agent.run", "agent");
    return ok({ profiles: await listMcpProfiles(principal) }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "agent.run", "agent");
    const body = await request.json() as { name?: string; endpoint?: string; instructions?: string };
    return ok({ profile: await createMcpProfile(principal, {
      name: body.name || "", endpoint: body.endpoint || "", instructions: body.instructions || "",
    }) }, traceId, { status: 201 });
  } catch (error) { return fail(error, traceId); }
}
