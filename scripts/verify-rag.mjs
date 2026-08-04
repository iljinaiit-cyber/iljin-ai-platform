#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import process from "node:process";

const DEFAULT_BASE_URL = "http://localhost:3000";
const ALLOWED_DEPARTMENT = "RAG-E2E-ALLOWED";
const DENIED_DEPARTMENT = "RAG-E2E-DENIED";
const REQUEST_TIMEOUT_MS = 90_000;

function resolveBaseUrl() {
  const equalsArgument = process.argv.find((argument) => argument.startsWith("--base-url="));
  const argumentIndex = process.argv.indexOf("--base-url");
  const argumentValue = argumentIndex >= 0 ? process.argv[argumentIndex + 1] : undefined;
  const value = equalsArgument?.slice("--base-url=".length) || argumentValue || process.env.BASE_URL || DEFAULT_BASE_URL;
  return value.replace(/\/+$/, "");
}

const baseUrl = resolveBaseUrl();
const runId = randomUUID().replaceAll("-", "").toUpperCase();
const marker = `RAG-E2E-${runId}`;
const lookupToken = `ZXQ${runId}`;
const tracePrefix = `E2E-${runId.slice(0, 16)}`;
const title = `Document RAG 무키 E2E ${runId.slice(0, 12)}`;
const finalPhrase = `근거 기반 응답 완료 ${runId.slice(-8)}`;
const allowedEmail = `rag.allowed.${runId.toLowerCase()}@iljin.e2e`;
const deniedEmail = `rag.denied.${runId.toLowerCase()}@iljin.e2e`;

function identityHeaders(email, department) {
  return {
    "X-Dev-User-Email": email,
    "X-Dev-User-Department": department,
    "X-Dev-User-Role": "user",
  };
}

let passed = 0;
let assetId;
let targetCitation;

class VerificationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "VerificationError";
    this.details = details;
  }
}

function assert(condition, message, details) {
  if (!condition) throw new VerificationError(message, details);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function truncate(value, maxLength = 1_200) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  // This verifier intentionally sends no Authorization header and reads no API key.

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
    const raw = await response.text();
    let body;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    return { response, body };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new VerificationError(`${path} 요청이 제한 시간 안에 완료되지 않았습니다.`, {
        timeoutMs: options.timeoutMs || REQUEST_TIMEOUT_MS,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function expectStatus(result, expected, label) {
  assert(result.response.status === expected, `${label}: HTTP ${expected}가 필요하지만 ${result.response.status}를 받았습니다.`, result.body);
}

async function step(name, operation) {
  const startedAt = Date.now();
  await operation();
  passed += 1;
  console.log(`[PASS] ${name} (${Date.now() - startedAt}ms)`);
}

const fixture = {
  documentType: "document-rag-e2e-fixture",
  verificationCode: marker,
  opaqueLookupToken: lookupToken,
  ownerDepartment: ALLOWED_DEPARTMENT,
  procedure: ["수집", "청킹", "ACL 검증", "Citation 반환"],
  finalConfirmation: finalPhrase,
  rule: "이 문서의 정보는 허용된 부서에만 검색 근거로 제공한다.",
};

async function main() {
  console.log(`Document RAG 무키 E2E 시작: ${baseUrl}`);
  console.log(`검증 마커: ${marker}`);

  await step("RAG 런타임 준비 상태", async () => {
    const result = await request("/api/health", { timeoutMs: 10_000 });
    expectStatus(result, 200, "Health API");
    assert(result.body?.status === "ready", "서버 상태가 ready가 아닙니다.", result.body);
    assert(result.body?.rag?.d1Configured === true, "D1 바인딩이 준비되지 않았습니다.", result.body?.rag);
    assert(result.body?.rag?.r2Configured === true, "R2 바인딩이 준비되지 않았습니다.", result.body?.rag);
    assert(result.body?.rag?.embeddingConfigured === true, "서버측 임베딩 Provider가 준비되지 않았습니다.", result.body?.rag);
  });

  await step("JSON 문서 인덱싱", async () => {
    const result = await request("/api/v1/assets", {
      method: "POST",
      headers: {
        ...identityHeaders(allowedEmail, ALLOWED_DEPARTMENT),
        "Content-Type": "application/json; charset=utf-8",
        "X-Trace-Id": `${tracePrefix}-INGEST`,
      },
      body: JSON.stringify({
        title,
        content: JSON.stringify(fixture, null, 2),
        mimeType: "application/json",
        sourceType: "verify-rag-script",
        classification: "internal",
        departmentScope: [ALLOWED_DEPARTMENT],
      }),
    });
    expectStatus(result, 201, "Asset 인덱싱 API");
    assert(typeof result.body?.assetId === "string" && result.body.assetId.length > 0, "assetId가 없습니다.", result.body);
    assert(typeof result.body?.jobId === "string" && result.body.jobId.length > 0, "jobId가 없습니다.", result.body);
    assert(result.body?.status === "indexed", "문서가 indexed 상태가 아닙니다.", result.body);
    assert(Number.isInteger(result.body?.segmentCount) && result.body.segmentCount > 0, "생성된 Segment가 없습니다.", result.body);
    assert(typeof result.body?.checksum === "string" && result.body.checksum.length === 64, "SHA-256 checksum 형식이 아닙니다.", result.body);
    assetId = result.body.assetId;
  });

  await step("허용 부서 검색 노출", async () => {
    const result = await request("/api/v1/search", {
      method: "POST",
      headers: {
        ...identityHeaders(allowedEmail, ALLOWED_DEPARTMENT),
        "Content-Type": "application/json; charset=utf-8",
        "X-Trace-Id": `${tracePrefix}-ALLOW`,
      },
      body: JSON.stringify({ query: lookupToken, department: ALLOWED_DEPARTMENT, limit: 10 }),
    });
    expectStatus(result, 200, "허용 부서 Search API");
    assert(result.body?.grounded === true, "허용 부서 검색이 grounded 결과를 반환하지 않았습니다.", result.body);
    assert(Array.isArray(result.body?.citations), "검색 응답의 citations가 배열이 아닙니다.", result.body);
    targetCitation = result.body.citations.find((citation) => citation?.assetId === assetId);
    assert(targetCitation, "인덱싱한 문서가 허용 부서 검색 결과에 없습니다.", result.body?.citations);
    assert(result.body?.retrieval?.strategy === "hybrid", "검색 전략이 hybrid가 아닙니다.", result.body?.retrieval);
    assert(result.response.headers.get("x-search-strategy") === "hybrid", "X-Search-Strategy 응답 헤더가 없습니다.");
    assert(typeof result.body?.traceId === "string" && result.body.traceId.length > 0, "검색 Trace ID가 없습니다.", result.body);
  });

  await step("Citation 필수 필드와 원문 locator", async () => {
    const citation = targetCitation;
    assert(typeof citation.id === "string" && /^S\d+$/.test(citation.id), "Citation id 형식이 올바르지 않습니다.", citation);
    assert(citation.assetId === assetId, "Citation assetId가 인덱싱 결과와 다릅니다.", citation);
    assert(typeof citation.segmentId === "string" && citation.segmentId.length > 0, "Citation segmentId가 없습니다.", citation);
    assert(citation.title === title, "Citation title이 원문 제목과 다릅니다.", citation);
    assert(Number.isInteger(citation.pageNumber) && citation.pageNumber > 0, "Citation pageNumber가 없습니다.", citation);
    assert(typeof citation.excerpt === "string" && citation.excerpt.includes(marker), "Citation excerpt에 검증 마커가 없습니다.", citation);
    assert(finiteNumber(citation.score), "Citation score가 유한 숫자가 아닙니다.", citation);
    assert(finiteNumber(citation.lexicalScore), "Citation lexicalScore가 유한 숫자가 아닙니다.", citation);
    assert(finiteNumber(citation.denseScore), "Citation denseScore가 유한 숫자가 아닙니다.", citation);

    const params = new URLSearchParams({ asset_id: assetId, segment_id: citation.segmentId });
    const detail = await request(`/api/v1/citations?${params}`, {
      headers: identityHeaders(allowedEmail, ALLOWED_DEPARTMENT),
    });
    expectStatus(detail, 200, "Citation 상세 API");
    assert(detail.body?.asset_id === assetId, "Citation 상세 asset_id가 다릅니다.", detail.body);
    assert(detail.body?.segment_id === citation.segmentId, "Citation 상세 segment_id가 다릅니다.", detail.body);
    assert(detail.body?.title === title, "Citation 상세 title이 다릅니다.", detail.body);
    assert(typeof detail.body?.content === "string" && detail.body.content.includes(marker), "Citation 상세 원문에 검증 마커가 없습니다.", detail.body);
    assert(Number.isInteger(detail.body?.page_number) && detail.body.page_number > 0, "Citation 상세 page_number가 없습니다.", detail.body);
  });

  await step("비허용 부서 대상 Asset 0건", async () => {
    const result = await request("/api/v1/search", {
      method: "POST",
      headers: {
        ...identityHeaders(deniedEmail, DENIED_DEPARTMENT),
        "Content-Type": "application/json; charset=utf-8",
        "X-Trace-Id": `${tracePrefix}-DENY`,
      },
      body: JSON.stringify({ query: lookupToken, department: DENIED_DEPARTMENT, limit: 10 }),
    });
    expectStatus(result, 200, "비허용 부서 Search API");
    assert(Array.isArray(result.body?.citations), "비허용 검색 응답의 citations가 배열이 아닙니다.", result.body);
    assert(
      !result.body.citations.some((citation) => citation?.assetId === assetId),
      "비허용 부서에 제한 Asset이 노출됐습니다.",
      result.body.citations,
    );
    const serialized = JSON.stringify(result.body.citations);
    assert(
      !serialized.includes(marker) && !serialized.includes(title),
      "비허용 부서 검색 결과가 제한 문서 정보를 노출했습니다.",
      result.body.citations,
    );
  });

  await step("비허용 부서 Citation 직접 접근 차단", async () => {
    const params = new URLSearchParams({ asset_id: assetId, segment_id: targetCitation.segmentId });
    const result = await request(`/api/v1/citations?${params}`, {
      headers: identityHeaders(deniedEmail, DENIED_DEPARTMENT),
    });
    expectStatus(result, 404, "비허용 Citation 상세 API");
    assert(result.body?.error?.code === "CITATION_NOT_FOUND", "비허용 Citation 오류 코드가 올바르지 않습니다.", result.body);
    const serialized = JSON.stringify(result.body);
    assert(!serialized.includes(marker) && !serialized.includes(title), "차단 응답이 문서 정보를 노출했습니다.", result.body);
  });

  await step("무관 질문 422 차단", async () => {
    const unrelated = "목성 대적점의 대기 조성과 황제펭귄 포란 생태";
    const search = await request("/api/v1/search", {
      method: "POST",
      headers: {
        ...identityHeaders(allowedEmail, ALLOWED_DEPARTMENT),
        "Content-Type": "application/json; charset=utf-8",
        "X-Trace-Id": `${tracePrefix}-EMPTY-SEARCH`,
      },
      body: JSON.stringify({ query: unrelated, department: ALLOWED_DEPARTMENT, limit: 3 }),
    });
    expectStatus(search, 200, "무관 질문 사전 Search API");
    assert(search.body?.grounded === false && search.body?.citations?.length === 0, "무관 질문이 검색 단계에서 근거 없음으로 판정되지 않았습니다.", search.body);

    const result = await request("/api/v1/chat/completions", {
      method: "POST",
      headers: {
        ...identityHeaders(allowedEmail, ALLOWED_DEPARTMENT),
        "Content-Type": "application/json; charset=utf-8",
        "X-Trace-Id": `${tracePrefix}-EMPTY`,
      },
      body: JSON.stringify({
        rag: true,
        stream: false,
        department: ALLOWED_DEPARTMENT,
        messages: [{ role: "user", content: unrelated }],
      }),
    });
    expectStatus(result, 422, "근거 부족 RAG Chat API");
    assert(result.body?.error?.code === "INSUFFICIENT_EVIDENCE", "근거 부족 오류 코드가 올바르지 않습니다.", result.body);
    assert(typeof result.body?.error?.trace_id === "string", "근거 부족 오류에 trace_id가 없습니다.", result.body);
    assert(result.response.headers.get("cache-control") === "no-store", "근거 부족 응답이 no-store가 아닙니다.");
  });

  await step("RAG Chat grounded 응답과 Citation 연결", async () => {
    const question = `${lookupToken} 문서의 처리 단계와 최종 확인 문구는 무엇인가요?`;
    const result = await request("/api/v1/chat/completions", {
      method: "POST",
      headers: {
        ...identityHeaders(allowedEmail, ALLOWED_DEPARTMENT),
        "Content-Type": "application/json; charset=utf-8",
        "X-Trace-Id": `${tracePrefix}-CHAT`,
      },
      body: JSON.stringify({
        rag: true,
        stream: false,
        sensitivity: "internal",
        department: ALLOWED_DEPARTMENT,
        messages: [{ role: "user", content: question }],
      }),
      timeoutMs: 120_000,
    });
    expectStatus(result, 200, "Grounded RAG Chat API");
    assert(result.body?.grounded === true, "RAG Chat 응답이 grounded=true가 아닙니다.", result.body);
    assert(Array.isArray(result.body?.citations) && result.body.citations.length > 0, "RAG Chat Citation이 없습니다.", result.body);
    assert(result.body.citations.some((citation) => citation?.assetId === assetId), "RAG Chat Citation이 인덱싱 문서를 참조하지 않습니다.", result.body.citations);
    assert(result.body?.retrieval?.strategy === "hybrid", "RAG Chat retrieval 전략이 hybrid가 아닙니다.", result.body?.retrieval);
    assert(["local", "cloudflare"].includes(result.body?.provider), "RAG Chat Provider가 허용된 경로가 아닙니다.", result.body);

    const answer = result.body?.choices?.[0]?.message?.content;
    assert(typeof answer === "string" && answer.trim().length > 0, "RAG Chat 답변 본문이 없습니다.", result.body?.choices);
    assert(answer.includes(finalPhrase), "RAG Chat 답변이 제공된 근거의 최종 확인 문구를 포함하지 않습니다.", answer);
    const referencedIds = [...answer.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]);
    assert(referencedIds.length > 0, "RAG Chat 답변에 [S1] 형식의 근거 참조가 없습니다.", answer);
    const citationIds = new Set(result.body.citations.map((citation) => citation?.id));
    assert(referencedIds.every((id) => citationIds.has(id)), "답변이 citations에 없는 근거 ID를 참조했습니다.", {
      referencedIds,
      citationIds: [...citationIds],
    });
    assert(typeof result.body?.trace_id === "string" && result.body.trace_id.length > 0, "RAG Chat trace_id가 없습니다.", result.body);
    assert(result.response.headers.get("cache-control") === "no-store", "RAG Chat 응답이 no-store가 아닙니다.");
  });

  await step("검증 Asset cleanup", async () => {
    const deleted = await request(`/api/v1/assets/${encodeURIComponent(assetId)}`, {
      method: "DELETE",
      headers: identityHeaders(allowedEmail, ALLOWED_DEPARTMENT),
    });
    expectStatus(deleted, 204, "Asset cleanup API");
    assetId = undefined;
  });

  console.log(`\n[PASS] Document RAG 무키 E2E 완료: ${passed}단계 통과`);
  console.log("검증 Asset cleanup을 완료했습니다.");
  console.log("이 스크립트는 API 키를 읽거나 Authorization 헤더를 전송하지 않았습니다.");
}

main().catch(async (error) => {
  console.error(`\n[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof VerificationError && error.details !== undefined) {
    console.error(truncate(error.details));
  } else if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  if (assetId) {
    try {
      await request(`/api/v1/assets/${encodeURIComponent(assetId)}`, {
        method: "DELETE",
        headers: identityHeaders(allowedEmail, ALLOWED_DEPARTMENT),
      });
      console.error("실패 전 생성된 Asset cleanup을 완료했습니다.");
    } catch {
      console.error(`실패 전 생성된 Asset cleanup 필요: ${assetId}`);
    }
  }
  process.exitCode = 1;
});
