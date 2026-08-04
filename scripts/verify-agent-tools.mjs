#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import process from "node:process";

const baseUrl = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const runToken = randomUUID().replaceAll("-", "").toLowerCase();
const user = { email: `agent.user.${runToken}@iljin.e2e`, department: "AGENT-E2E", role: "user" };
const manager = { email: `agent.manager.${runToken}@iljin.e2e`, department: "AGENT-E2E", role: "manager" };
const admin = { email: `agent.admin.${runToken}@iljin.e2e`, department: "AGENT-E2E", role: "admin" };
let passed = 0;

function headers(principal, extra = {}) {
  return {
    Accept: "application/json",
    "x-dev-user-email": principal.email,
    "x-dev-user-department": principal.department,
    "x-dev-user-role": principal.role,
    ...extra,
  };
}

async function request(path, principal, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: headers(principal, options.headers || {}),
  });
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : undefined; } catch { body = raw; }
  return { response, body };
}

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details === undefined ? "" : `\n${JSON.stringify(details, null, 2)}`}`);
}

function expect(result, status, label) {
  assert(result.response.status === status, `${label}: HTTP ${status} 대신 ${result.response.status}`, result.body);
  assert(result.response.headers.get("x-trace-id"), `${label}: X-Trace-Id 누락`, result.body);
}

async function step(label, operation) {
  const started = Date.now();
  await operation();
  passed += 1;
  console.log(`[PASS] ${label} (${Date.now() - started}ms)`);
}

async function createRun(principal, { objective, toolId, idempotencyKey }) {
  return request("/api/v1/agent/runs", principal, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      objective,
      tool_id: toolId,
      tool_input: toolId === "knowledge.search" ? { query: objective } : { change: objective },
    }),
  });
}

console.log(`Agent/Tool E2E 시작: ${baseUrl}`);

await step("Tool registry와 외부 Adapter 비활성 계약", async () => {
  const result = await request("/api/v1/tools", user);
  expect(result, 200, "Tool registry");
  assert(Array.isArray(result.body?.items), "Tool registry items가 배열이 아닙니다.", result.body);
  const builtins = result.body.items.filter((tool) => tool.adapterType === "builtin" && tool.enabled);
  const external = result.body.items.filter((tool) => tool.adapterType === "external");
  assert(builtins.length === 3, "활성 built-in Tool이 3종이 아닙니다.", builtins);
  assert(external.length >= 4 && external.every((tool) => tool.enabled === false), "외부 Adapter가 모두 비활성이 아닙니다.", external);
  assert(result.body.items.find((tool) => tool.id === "controlled.change_evidence")?.approvalRequired === true, "R2 Demo Tool의 승인 정책이 없습니다.");
});

let completedRunId;
const r0Key = `agent-r0-${runToken}`;
await step("R0 Agent 5상태 실행과 실제 D1 결과", async () => {
  const result = await createRun(user, {
    objective: "현재 RAG 플랫폼 상태와 접근 가능한 문서 규모를 확인해줘.",
    toolId: "platform.rag_status",
    idempotencyKey: r0Key,
  });
  expect(result, 201, "R0 Agent 실행");
  assert(result.body?.run?.status === "completed", "R0 Agent가 완료되지 않았습니다.", result.body);
  assert(result.body.run.iterationCount === 5 && result.body.run.steps?.length === 5, "Router~Execution 5단계가 저장되지 않았습니다.", result.body.run);
  assert(result.body.run.steps.map((item) => item.stepType).join(",") === "router,planner,retrieval,verification,execution", "Agent 상태 순서가 다릅니다.", result.body.run.steps);
  assert(result.body.run.output?.externalWrite === false, "Built-in Tool이 외부 쓰기 없음으로 표시되지 않았습니다.", result.body.run.output);
  completedRunId = result.body.run.id;
});

await step("Agent 생성 Idempotency replay", async () => {
  const result = await createRun(user, {
    objective: "다시 호출해도 같은 실행을 반환해야 합니다.",
    toolId: "platform.rag_status",
    idempotencyKey: r0Key,
  });
  expect(result, 200, "Agent Idempotency replay");
  assert(result.body?.reused === true && result.body?.run?.id === completedRunId, "동일 키가 기존 실행을 재사용하지 않았습니다.", result.body);
  assert(result.response.headers.get("idempotency-replayed") === "true", "Idempotency-Replayed 헤더가 없습니다.");
});

let approvalId;
let approvalRunId;
await step("R2 Agent 실행 차단과 명시적 승인 요청", async () => {
  const result = await createRun(user, {
    objective: "승인 통제 경로의 변경 증빙을 만들어줘.",
    toolId: "controlled.change_evidence",
    idempotencyKey: `agent-r2-${runToken}`,
  });
  expect(result, 202, "R2 Agent 승인 요청");
  assert(result.body?.run?.status === "awaiting_approval", "R2 Agent가 승인 대기 상태가 아닙니다.", result.body);
  assert(result.body.run.executions?.length === 0, "승인 전 Tool execution이 생성됐습니다.", result.body.run.executions);
  assert(result.body.run.approvals?.[0]?.status === "pending", "승인 요청이 pending이 아닙니다.", result.body.run.approvals);
  approvalId = result.body.run.approvals[0].id;
  approvalRunId = result.body.run.id;
});

await step("별도 매니저 승인 후 멱등 Tool 실행", async () => {
  const result = await request(`/api/v1/tool-approvals/${encodeURIComponent(approvalId)}`, manager, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision: "approved", note: "Agent E2E 명시적 승인" }),
  });
  expect(result, 200, "R2 Tool 승인");
  assert(result.body?.run?.id === approvalRunId && result.body.run.status === "completed", "승인 후 Agent가 완료되지 않았습니다.", result.body);
  assert(result.body.run.executions?.length === 1 && result.body.run.executions[0].status === "completed", "Tool 실행이 정확히 1건 완료되지 않았습니다.", result.body.run.executions);
  assert(result.body.run.output?.executionMode === "read_only_demo" && result.body.run.output?.externalWrite === false, "Demo Tool이 외부 변경 없이 실행되지 않았습니다.", result.body.run.output);

  const replay = await request(`/api/v1/tool-approvals/${encodeURIComponent(approvalId)}`, admin, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision: "approved" }),
  });
  expect(replay, 409, "중복 승인 차단");
});

await step("R2 요청자 자가 승인 차단", async () => {
  const created = await createRun(manager, {
    objective: "자가 승인 금지 정책을 확인할 통제 증빙",
    toolId: "controlled.change_evidence",
    idempotencyKey: `agent-self-${runToken}`,
  });
  expect(created, 202, "자가 승인 테스트 생성");
  const selfApprovalId = created.body.run.approvals[0].id;
  const denied = await request(`/api/v1/tool-approvals/${encodeURIComponent(selfApprovalId)}`, manager, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision: "approved" }),
  });
  expect(denied, 403, "자가 승인 차단");
  assert(denied.body?.error?.code === "TOOL_SELF_APPROVAL_FORBIDDEN", "자가 승인 오류 코드가 다릅니다.", denied.body);
  const rejected = await request(`/api/v1/tool-approvals/${encodeURIComponent(selfApprovalId)}`, admin, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision: "rejected", note: "E2E 정리" }),
  });
  expect(rejected, 200, "자가 승인 테스트 정리");
  assert(rejected.body?.run?.status === "cancelled", "거절된 Agent가 취소 상태가 아닙니다.", rejected.body);
});

await step("외부 ERP/MES/HR/ITSM Tool 실행 차단", async () => {
  const result = await createRun(admin, {
    objective: "비활성 외부 Adapter 호출은 차단되어야 합니다.",
    toolId: "hr.travel.submit",
    idempotencyKey: `agent-disabled-${runToken}`,
  });
  expect(result, 409, "외부 Adapter 실행 차단");
  assert(result.body?.error?.code === "TOOL_DISABLED", "비활성 Tool 오류 코드가 다릅니다.", result.body);
});

await step("역할별 승인함 가시성과 접근 승인 분리", async () => {
  const userList = await request("/api/v1/tool-approvals", user);
  expect(userList, 200, "사용자 Tool 승인함");
  assert(userList.body?.items?.some((item) => item.id === approvalId && item.status === "consumed"), "사용자가 자신의 Tool 승인 이력을 볼 수 없습니다.", userList.body);
  const managerList = await request("/api/v1/tool-approvals", manager);
  expect(managerList, 200, "매니저 Tool 승인함");
  assert(managerList.body?.items?.some((item) => item.id === approvalId), "매니저가 Tenant Tool 승인 이력을 볼 수 없습니다.", managerList.body);

  const accessQueue = await request("/api/admin/access-requests", admin);
  expect(accessQueue, 200, "사용자 접근 승인함");
  assert(!accessQueue.body?.items?.some((item) => item.id === approvalId), "업무 Tool 승인이 사용자 접근 승인함에 혼입됐습니다.", accessQueue.body);
});

console.log(`\n[PASS] Agent/Tool E2E 완료: ${passed}단계 통과`);
