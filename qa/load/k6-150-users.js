/* global __VU, __ITER */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const SEARCH_QUERY = __ENV.QA_SEARCH_QUERY || "안전보건 규정";
const CHAT_QUERY = __ENV.QA_CHAT_QUERY || "근거를 인용해 안전보건 규정을 요약해 주세요.";
const USER_POOL = (__ENV.QA_USER_POOL || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const searchLatency = new Trend("qa_search_duration", true);
const portalLatency = new Trend("qa_portal_duration", true);
const ragLatency = new Trend("qa_rag_duration", true);
const firstTokenLatency = new Trend("qa_first_token_duration", true);
const functionalFailure = new Rate("qa_functional_failure");

export const options = {
  scenarios: {
    portal_navigation: {
      executor: "constant-vus",
      vus: 40,
      duration: __ENV.QA_DURATION || "5m",
      exec: "portal",
      tags: { workload: "portal" },
    },
    document_search: {
      executor: "constant-vus",
      vus: 60,
      duration: __ENV.QA_DURATION || "5m",
      exec: "search",
      tags: { workload: "search" },
    },
    grounded_chat: {
      executor: "constant-vus",
      vus: 50,
      duration: __ENV.QA_DURATION || "5m",
      exec: "chat",
      tags: { workload: "chat" },
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    qa_functional_failure: ["rate<0.01"],
    qa_portal_duration: ["p(95)<3000"],
    qa_search_duration: ["p(95)<2000", "p(99)<4000"],
    qa_first_token_duration: ["p(95)<3000"],
    qa_rag_duration: ["p(95)<8000", "p(99)<12000"],
  },
};

function authHeaders() {
  const headers = { Accept: "application/json" };
  if (__ENV.QA_AUTH_HEADER_NAME && __ENV.QA_AUTH_HEADER_VALUE) {
    headers[__ENV.QA_AUTH_HEADER_NAME] = __ENV.QA_AUTH_HEADER_VALUE;
    return headers;
  }
  if (__ENV.QA_ALLOW_DEV_IDENTITY === "true") {
    const email = USER_POOL.length
      ? USER_POOL[(__VU - 1) % USER_POOL.length]
      : `load.user.${__VU}@iljin.qa`;
    headers["x-dev-user-email"] = email;
    headers["x-dev-user-department"] = __ENV.QA_DEPARTMENT || "QA-LOAD";
    headers["x-dev-user-role"] = "user";
  }
  return headers;
}

function record(response, metric, expected = 200) {
  metric.add(response.timings.duration);
  const passed = check(response, {
    [`HTTP ${expected}`]: (result) => result.status === expected,
    "trace header present": (result) => Boolean(result.headers["X-Trace-Id"]),
  });
  functionalFailure.add(!passed);
}

export function portal() {
  const response = http.get(`${BASE_URL}/`, { tags: { name: "GET portal" } });
  portalLatency.add(response.timings.duration);
  const passed = check(response, {
    "portal HTTP 200": (result) => result.status === 200,
    "portal is HTML": (result) => String(result.headers["Content-Type"] || "").includes("text/html"),
  });
  functionalFailure.add(!passed);
  sleep(1);
}

export function search() {
  const response = http.post(
    `${BASE_URL}/api/v1/search`,
    JSON.stringify({ query: SEARCH_QUERY, limit: 5 }),
    {
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      tags: { name: "POST search" },
    },
  );
  record(response, searchLatency);
  sleep(1);
}

export function chat() {
  const response = http.post(
    `${BASE_URL}/api/v1/chat/completions`,
    JSON.stringify({
      rag: true,
      stream: true,
      messages: [{ role: "user", content: `${CHAT_QUERY} [${__VU}-${__ITER}]` }],
    }),
    {
      headers: { ...authHeaders(), Accept: "text/event-stream", "Content-Type": "application/json" },
      tags: { name: "POST grounded chat SSE" },
      timeout: "30s",
    },
  );
  firstTokenLatency.add(response.timings.waiting);
  record(response, ragLatency);
  const hasSseCompletion = response.status === 200 && response.body?.includes("event: done");
  functionalFailure.add(!hasSseCompletion);
  sleep(1);
}

export function setup() {
  const response = http.get(`${BASE_URL}/api/health`, { tags: { name: "GET health setup" } });
  if (response.status !== 200) throw new Error(`Health preflight failed: HTTP ${response.status}`);
  if (!__ENV.QA_AUTH_HEADER_NAME && __ENV.QA_ALLOW_DEV_IDENTITY !== "true") {
    throw new Error("Set QA_AUTH_HEADER_NAME/QA_AUTH_HEADER_VALUE or explicitly enable local QA_ALLOW_DEV_IDENTITY=true.");
  }
  if (__ENV.QA_ALLOW_DEV_IDENTITY === "true" && USER_POOL.length > 0 && USER_POOL.length < 150) {
    throw new Error("QA_USER_POOL must contain at least 150 unique users to avoid per-user rate-limit distortion.");
  }
}
