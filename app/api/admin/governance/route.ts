import {
  getGovernanceDashboard,
  deleteManagedUser,
  grantUserTokens,
  updateFeatureSetting,
  updateManagedUser,
  updateRolePermission,
  updateScopedPermission,
  updateUserTokenPolicy,
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
          displayName: String(body.displayName ?? ""),
          role: body.role as Parameters<typeof updateManagedUser>[0]["role"],
          status: body.status as Parameters<typeof updateManagedUser>[0]["status"],
          department: String(body.department ?? ""),
          jobTitle: String(body.jobTitle ?? ""),
          traceId,
        });
        break;
      case "scoped_permission":
        await updateScopedPermission({
          principal,
          scope: body.scope as Parameters<typeof updateScopedPermission>[0]["scope"],
          targetKey: String(body.targetKey ?? ""),
          permissionKey: String(body.permissionKey ?? ""),
          allowed: body.allowed === null ? null : body.allowed === true,
          traceId,
        });
        break;
      case "delete_user":
        await deleteManagedUser({ principal, email: String(body.email ?? ""), traceId });
        break;
      case "token_policy":
        await updateUserTokenPolicy({
          principal, email: String(body.email ?? ""), monthlyLimitTokens: body.monthlyLimitTokens,
          tokenBalance: body.tokenBalance, traceId,
        });
        break;
      case "grant_tokens":
        await grantUserTokens({ principal, email: String(body.email ?? ""), tokens: body.tokens, traceId });
        break;
      default:
        return ok({ error: { code: "INVALID_ACTION", message: "지원하지 않는 변경 요청입니다." } }, traceId, { status: 400 });
    }
    return ok({ updated: true }, traceId);
  } catch (error) { return fail(error, traceId); }
}
