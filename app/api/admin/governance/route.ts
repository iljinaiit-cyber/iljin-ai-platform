import {
  getGovernanceDashboard,
  updateFeatureSetting,
  updateManagedUser,
  updateRolePermission,
  updateUserPermission,
} from "../../../../lib/admin-governance";
import { resolvePrincipal } from "../../../../lib/identity";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    return ok(await getGovernanceDashboard(await resolvePrincipal(request)), traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    const body = await request.json() as Record<string, unknown>;
    switch (body.action) {
      case "role_permission":
        await updateRolePermission({
          principal,
          role: body.role as Parameters<typeof updateRolePermission>[0]["role"],
          permissionKey: String(body.permissionKey ?? ""),
          allowed: body.allowed === true,
          traceId,
        });
        break;
      case "user_permission":
        await updateUserPermission({
          principal,
          email: String(body.email ?? ""),
          permissionKey: String(body.permissionKey ?? ""),
          allowed: body.allowed === null ? null : body.allowed === true,
          traceId,
        });
        break;
      case "feature":
        await updateFeatureSetting({ principal, featureKey: String(body.featureKey ?? ""), enabled: body.enabled === true, traceId });
        break;
      case "user":
        await updateManagedUser({
          principal,
          email: String(body.email ?? ""),
          role: body.role as Parameters<typeof updateManagedUser>[0]["role"],
          status: body.status as Parameters<typeof updateManagedUser>[0]["status"],
          department: String(body.department ?? ""),
          traceId,
        });
        break;
      default:
        return ok({ error: { code: "INVALID_ACTION", message: "지원하지 않는 변경 요청입니다." } }, traceId, { status: 400 });
    }
    return ok({ updated: true }, traceId);
  } catch (error) { return fail(error, traceId); }
}
