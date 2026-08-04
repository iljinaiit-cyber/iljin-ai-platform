#!/usr/bin/env node

import { randomUUID } from "node:crypto";

const baseUrl = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const runId = randomUUID().replaceAll("-", "").toLowerCase();
const userEmail = `approval.user.${runId}@iljin.e2e`;
const approvedDepartment = `APPROVED-${runId.slice(0, 8)}`;
const applicationNote = `이메일 가입 신청 자동 검증 ${runId.slice(0, 10)}`;
const userHeaders = {
  "oai-authenticated-user-email": userEmail,
  "oai-authenticated-user-full-name": encodeURIComponent("승인 검증 사용자"),
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
};
const adminHeaders = {
  "x-dev-user-email": `approval.admin.${runId}@iljin.e2e`,
  "x-dev-user-department": "ACCESS-CONTROL",
  "x-dev-user-role": "admin",
};

async function request(path, { headers = {}, ...options } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { Accept: "application/json", ...headers, ...(options.body ? { "Content-Type": "application/json" } : {}) },
  });
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : undefined; } catch { body = raw; }
  return { response, body };
}

function expect(result, status, label) {
  if (result.response.status !== status) {
    throw new Error(`${label}: HTTP ${result.response.status} ${JSON.stringify(result.body)}`);
  }
}

const firstLogin = await request("/api/auth/me", { headers: userHeaders });
expect(firstLogin, 200, "최초 로그인");
if (firstLogin.body?.user?.status !== "unrequested") throw new Error("신규 사용자가 가입 신청 전 상태로 등록되지 않았습니다.");
console.log("[PASS] 이메일 인증 후 가입 신청 전 상태");

const blocked = await request("/api/v1/conversations", { headers: userHeaders });
expect(blocked, 403, "미승인 업무 API");
if (blocked.body?.error?.code !== "AUTH_APPLICATION_REQUIRED") throw new Error("가입 신청 전 차단 코드가 올바르지 않습니다.");
console.log("[PASS] 가입 신청 전 업무 API 차단");

const application = await request("/api/auth/application", {
  headers: userHeaders,
  method: "POST",
  body: JSON.stringify({ department: approvedDepartment, note: applicationNote }),
});
expect(application, 201, "이메일 가입 신청");
if (application.body?.user?.status !== "pending" || application.body?.user?.applicationNote !== applicationNote) {
  throw new Error("가입 신청 상태 또는 신청 사유가 반영되지 않았습니다.");
}
console.log("[PASS] 이메일 가입 신청 접수");

const pendingBlocked = await request("/api/v1/conversations", { headers: userHeaders });
expect(pendingBlocked, 403, "승인 대기 업무 API");
if (pendingBlocked.body?.error?.code !== "AUTH_APPROVAL_REQUIRED") throw new Error("승인 대기 차단 코드가 올바르지 않습니다.");
console.log("[PASS] 관리자 승인 전 업무 API 차단");

const queue = await request("/api/admin/access-requests", { headers: adminHeaders });
expect(queue, 200, "관리자 승인 목록");
if (!queue.body?.items?.some((item) => item.email === userEmail && item.status === "pending" && item.applicationNote === applicationNote)) {
  throw new Error("관리자 승인 목록에서 신규 사용자를 찾지 못했습니다.");
}
console.log("[PASS] 관리자 승인 목록 등록");

const approved = await request("/api/admin/access-requests", {
  headers: adminHeaders,
  method: "PATCH",
  body: JSON.stringify({ email: userEmail, decision: "approved", department: approvedDepartment, role: "user" }),
});
expect(approved, 200, "관리자 승인");
if (approved.body?.user?.status !== "approved" || approved.body?.user?.department !== approvedDepartment) {
  throw new Error("승인 결과에 부서 또는 상태가 반영되지 않았습니다.");
}
console.log("[PASS] 관리자 부서 지정 및 승인");

const allowed = await request("/api/v1/conversations", { headers: userHeaders });
expect(allowed, 200, "승인 후 업무 API");
console.log("[PASS] 승인 후 업무 API 허용");

const rejected = await request("/api/admin/access-requests", {
  headers: adminHeaders,
  method: "PATCH",
  body: JSON.stringify({ email: userEmail, decision: "rejected", department: approvedDepartment, role: "user", reason: "자동 검증 정리" }),
});
expect(rejected, 200, "관리자 거절");

const blockedAgain = await request("/api/v1/conversations", { headers: userHeaders });
expect(blockedAgain, 403, "거절 후 업무 API");
if (blockedAgain.body?.error?.code !== "AUTH_REJECTED") throw new Error("거절 후 차단 코드가 올바르지 않습니다.");
console.log("[PASS] 거절 후 접근 재차단 및 검증 완료");

const reapplied = await request("/api/auth/application", {
  headers: userHeaders,
  method: "POST",
  body: JSON.stringify({ department: approvedDepartment, note: `${applicationNote} 재신청` }),
});
expect(reapplied, 201, "가입 재신청");
if (reapplied.body?.user?.status !== "pending") throw new Error("반려 사용자의 재신청이 승인 대기로 전환되지 않았습니다.");
console.log("[PASS] 반려 후 가입 재신청");

await request("/api/admin/access-requests", {
  headers: adminHeaders,
  method: "PATCH",
  body: JSON.stringify({ email: userEmail, decision: "rejected", department: approvedDepartment, role: "user", reason: "자동 검증 정리" }),
});
