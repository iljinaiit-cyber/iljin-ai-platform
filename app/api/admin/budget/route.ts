import { resolvePrincipal } from "../../../../lib/identity";
import { requirePermission, writeAudit } from "../../../../lib/admin-governance";
import { ensureBudgetPolicySchema, readDailyBudgetUsage } from "../../../../lib/guardrails";
import { listCorporations, listDepartments } from "../../../../lib/organization";
import { getD1 } from "../../../../db";
import { getCloudCostStatus } from "../../../../lib/cloud-cost-guard";
import { fail, newTraceId, ok } from "../../_shared";

/** 오늘 소진량 + 조직별 한도 정책. 관리자 콘솔 "비용" 탭의 데이터 원본이다. */
export async function GET(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await requirePermission(principal, "admin.operations");
    await ensureBudgetPolicySchema();
    const [usage, corporations, departments, policies, cloudCost] = await Promise.all([
      readDailyBudgetUsage(principal.tenantId),
      listCorporations(principal.tenantId),
      listDepartments(principal.tenantId),
      getD1().prepare(`SELECT scope, scope_id, daily_limit, updated_by, updated_at
        FROM ai_budget_policies WHERE tenant_id = ?`).bind(principal.tenantId)
        .all<{ scope: string; scope_id: string; daily_limit: number; updated_by: string; updated_at: string }>(),
      getCloudCostStatus(),
    ]);
    return ok({
      usage,
      cloudCost,
      corporations,
      departments,
      policies: (policies.results ?? []).map((p) => ({
        scope: p.scope, scopeId: p.scope_id, dailyLimit: Number(p.daily_limit),
        updatedBy: p.updated_by, updatedAt: p.updated_at,
      })),
    }, traceId);
  } catch (error) { return fail(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = newTraceId();
  try {
    const principal = await resolvePrincipal(request);
    await requirePermission(principal, "admin.settings");
    const body = await request.json() as {
      scope?: "corporation" | "department";
      scopeId?: string;
      dailyLimit?: number;
    };
    if (body.scope !== "corporation" && body.scope !== "department") {
      return ok({ error: "scope 는 corporation 또는 department 여야 합니다." }, traceId, { status: 400 });
    }
    const scopeId = (body.scopeId || "").trim();
    const limit = Number(body.dailyLimit);
    if (!scopeId || !Number.isFinite(limit) || limit < 0 || limit > 1_000_000) {
      return ok({ error: "조직과 한도(0~1,000,000)를 확인해 주세요." }, traceId, { status: 400 });
    }
    await ensureBudgetPolicySchema();
    const now = new Date().toISOString();
    if (limit === 0) {
      // 0 은 "한도 없음"이 아니라 "오버라이드 해제"다. 0 으로 잠그고 싶으면
      // 기능 토글(FEATURE_CATALOG)로 꺼야 한다 — 의도가 다른 두 조작을 섞지 않는다.
      await getD1().prepare("DELETE FROM ai_budget_policies WHERE tenant_id = ? AND scope = ? AND scope_id = ?")
        .bind(principal.tenantId, body.scope, scopeId).run();
    } else {
      await getD1().prepare(`INSERT INTO ai_budget_policies
        (tenant_id, scope, scope_id, daily_limit, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, scope, scope_id) DO UPDATE SET
          daily_limit = excluded.daily_limit, updated_by = excluded.updated_by,
          updated_at = excluded.updated_at`)
        .bind(principal.tenantId, body.scope, scopeId, Math.floor(limit), principal.email, now).run();
    }
    await writeAudit({
      principal, traceId, action: "budget.policy.updated",
      resourceType: body.scope, resourceId: scopeId,
      details: { dailyLimit: limit || null },
    });
    return ok({ scope: body.scope, scopeId, dailyLimit: limit || null }, traceId);
  } catch (error) { return fail(error, traceId); }
}
