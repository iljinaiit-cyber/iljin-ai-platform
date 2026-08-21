import { authorizeFeature } from "../../../../lib/admin-governance";
import { resolvePrincipal } from "../../../../lib/identity";
import { createSkill, listSkills } from "../../../../lib/skills";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "agent.run", "agent");
    return ok({ skills: await listSkills(principal) }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await authorizeFeature(principal, "agent.run", "agent");
    const body = await request.json() as { name?: string; steps?: string; triggerPatterns?: string; evidenceRequirements?: string };
    return ok({ skill: await createSkill(principal, {
      name: body.name || "",
      steps: (body.steps || "").split("\n"),
      triggerPatterns: (body.triggerPatterns || "").split("\n"),
      evidenceRequirements: body.evidenceRequirements || "",
    }) }, traceId, { status: 201 });
  } catch (error) { return fail(error, traceId); }
}
