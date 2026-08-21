import { getD1 } from "../db";
import { AuthError, type Principal } from "./identity";
import { verifyD1Schema } from "./d1-schema";

type AllocationRow = {
  email: string;
  monthly_limit_tokens: number | null;
  token_balance: number | null;
};

type UsageRow = { email: string; total_tokens: number | string | null };

export type UserTokenUsage = {
  email: string;
  usedThisMonth: number;
  monthlyLimitTokens: number | null;
  monthlyRemainingTokens: number | null;
  tokenBalance: number | null;
};

let tokenUsageSchemaPromise: Promise<void> | undefined;

export function ensureTokenUsageSchema() {
  if (!tokenUsageSchemaPromise) {
    tokenUsageSchemaPromise = verifyD1Schema({
      user_token_allocations: ["tenant_id", "email", "monthly_limit_tokens", "token_balance", "updated_by", "updated_at"],
    }).catch((error) => {
      tokenUsageSchemaPromise = undefined;
      throw error;
    });
  }
  return tokenUsageSchemaPromise;
}

function monthRange() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul", year: "numeric", month: "numeric",
  }).formatToParts(now);
  const part = (name: string) => Number(parts.find((item) => item.type === name)?.value);
  const year = part("year");
  const month = part("month");
  const start = new Date(Date.UTC(year, month - 1, 1, -9)).toISOString();
  const end = new Date(Date.UTC(year, month, 1, -9)).toISOString();
  return { start, end };
}

function normalize(value: number | string | null | undefined) {
  return Math.max(0, Number(value || 0));
}

export async function listUserTokenUsage(tenantId: string, emails: string[]) {
  await ensureTokenUsageSchema();
  const db = getD1();
  const { start, end } = monthRange();
  const [allocations, usage] = await Promise.all([
    db.prepare(`SELECT email, monthly_limit_tokens, token_balance FROM user_token_allocations
      WHERE tenant_id = ?`).bind(tenantId).all<AllocationRow>(),
    db.prepare(`SELECT owner_email AS email, SUM(total_tokens) AS total_tokens FROM llm_invocations
      WHERE tenant_id = ? AND created_at >= ? AND created_at < ? GROUP BY owner_email`).bind(tenantId, start, end).all<UsageRow>(),
  ]);
  const allocationByEmail = new Map((allocations.results || []).map((row) => [row.email, row]));
  const usageByEmail = new Map((usage.results || []).map((row) => [row.email, normalize(row.total_tokens)]));
  return emails.map((email): UserTokenUsage => {
    const allocation = allocationByEmail.get(email);
    const usedThisMonth = usageByEmail.get(email) || 0;
    const monthlyLimitTokens = allocation?.monthly_limit_tokens == null ? null : normalize(allocation.monthly_limit_tokens);
    return {
      email,
      usedThisMonth,
      monthlyLimitTokens,
      monthlyRemainingTokens: monthlyLimitTokens == null ? null : Math.max(0, monthlyLimitTokens - usedThisMonth),
      tokenBalance: allocation?.token_balance == null ? null : normalize(allocation.token_balance),
    };
  });
}

export async function assertUserTokenAllowance(principal: Principal) {
  const [usage] = await listUserTokenUsage(principal.tenantId, [principal.email]);
  if (usage.monthlyLimitTokens !== null && usage.usedThisMonth >= usage.monthlyLimitTokens) {
    throw new AuthError("이번 달 토큰 사용 한도에 도달했습니다. 관리자에게 문의해 주세요.", 429, "AUTH_FORBIDDEN");
  }
  if (usage.tokenBalance !== null && usage.tokenBalance <= 0) {
    throw new AuthError("부여된 토큰을 모두 사용했습니다. 관리자에게 추가 부여를 요청해 주세요.", 429, "AUTH_FORBIDDEN");
  }
}

export async function consumeUserTokens(input: { tenantId: string; email: string; tokens: number }) {
  const tokens = normalize(input.tokens);
  if (!tokens) return;
  await ensureTokenUsageSchema();
  await getD1().prepare(`UPDATE user_token_allocations
    SET token_balance = CASE WHEN token_balance IS NULL THEN NULL ELSE MAX(0, token_balance - ?) END,
        updated_at = ?
    WHERE tenant_id = ? AND email = ?`).bind(tokens, new Date().toISOString(), input.tenantId, input.email).run();
}

export function parseTokenAmount(value: unknown, field: string, nullable = false) {
  if (nullable && (value === null || value === "" || value === undefined)) return null;
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000) {
    throw new AuthError(`${field}은 0~100,000,000 사이의 정수로 입력해 주세요.`, 400, "AUTH_INVALID_INPUT");
  }
  return amount;
}
