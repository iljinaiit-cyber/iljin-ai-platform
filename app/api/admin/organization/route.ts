import { resolvePrincipal } from "../../../../lib/identity";
import { requirePermission, writeAudit } from "../../../../lib/admin-governance";
import {
  archiveDepartment,
  assignUserOrganization,
  createCorporation,
  createDepartment,
  listCorporations,
  listDepartments,
} from "../../../../lib/organization";
import { fail, newTraceId, ok } from "../../_shared";

export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await requirePermission(principal, "admin.users");
    const corpId = new URL(request.url).searchParams.get("corp_id") || undefined;
    const [corporations, departments] = await Promise.all([
      listCorporations(principal.tenantId),
      listDepartments(principal.tenantId, corpId),
    ]);
    return ok({ corporations, departments }, traceId);
  } catch (error) { return fail(error, traceId); }
}

type Body =
  | { action: "create_corporation"; name: string; code?: string }
  | { action: "create_department"; corpId: string; name: string; parentId?: string; code?: string }
  | { action: "archive_department"; deptId: string }
  | { action: "assign_user"; email: string; corpId?: string | null; deptId?: string | null };

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await requirePermission(principal, "admin.users");
    const body = await request.json() as Body;

    switch (body.action) {
      case "create_corporation": {
        const corporation = await createCorporation({ principal, name: body.name, code: body.code });
        await writeAudit({
          principal, traceId, action: "organization.corporation.created",
          resourceType: "corporation", resourceId: corporation.id,
          details: { name: corporation.name },
        });
        return ok({ corporation }, traceId, { status: 201 });
      }
      case "create_department": {
        const department = await createDepartment({
          principal, corpId: body.corpId, name: body.name,
          parentId: body.parentId, code: body.code,
        });
        await writeAudit({
          principal, traceId, action: "organization.department.created",
          resourceType: "department", resourceId: department.id,
          details: { name: department.name, corpId: body.corpId },
        });
        return ok({ department }, traceId, { status: 201 });
      }
      case "archive_department": {
        const result = await archiveDepartment({ principal, deptId: body.deptId });
        await writeAudit({
          principal, traceId, action: "organization.department.archived",
          resourceType: "department", resourceId: body.deptId,
          details: result,
        });
        return ok(result, traceId);
      }
      case "assign_user": {
        const result = await assignUserOrganization({
          principal, email: body.email,
          corpId: body.corpId ?? null, deptId: body.deptId ?? null,
        });
        await writeAudit({
          principal, traceId, action: "organization.user.assigned",
          resourceType: "user", resourceId: result.email,
          details: { corpId: result.corpId, deptId: result.deptId },
        });
        return ok(result, traceId);
      }
      default:
        return ok({ error: "알 수 없는 요청입니다." }, traceId, { status: 400 });
    }
  } catch (error) { return fail(error, traceId); }
}
