// 인터넷 검색 다중 Provider 병렬 조회 동작 테스트.
//
// "Provider 를 이렇게 구성하면 실제로 몇 개를 부르고 결과를 어떻게 합치는가"가
// 핵심이라 소스 문자열 검사로는 못 잡는다. TypeScript 소스를 esbuild 로 번들한
// 뒤 전역 fetch 를 가짜로 물려 실행한다.
//
// 배경: 예전에는 Provider 를 하나씩 순서대로 불러 결과가 충분해지면 그 자리에서
// 멈췄다 — 매 요청이 실질적으로 1개 소스에서만 답을 받았다. Tavily 옆에 Exa(임베딩
// 기반 의미 검색)를 추가하고, 우선순위 상위 Provider 를 배치로 병렬 조회해 병합하도록
// 바꿨다 — 비용은 배치 크기로 여전히 상한을 두면서 출처 다양성을 확보한다.
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let internetSearch;
let bundleDir;
let originalFetch;
let originalRuntime;

before(async () => {
  const esbuild = await import("esbuild").catch(() => undefined);
  if (!esbuild) return;
  bundleDir = await mkdtemp(join(tmpdir(), "iljin-internet-search-"));
  const outfile = join(bundleDir, "internet-search.mjs");
  await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../lib/internet-search.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    outfile,
  });
  internetSearch = await import(pathToFileURL(outfile).href);
  originalFetch = globalThis.fetch;
  originalRuntime = globalThis.__ILJIN_RUNTIME_ENV__;
});

after(async () => {
  if (bundleDir) await rm(bundleDir, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
  globalThis.__ILJIN_RUNTIME_ENV__ = originalRuntime;
});

const principal = { tenantId: "t1", department: "d1", email: "e@example.com" };

function jsonResponse(body) {
  return { ok: true, headers: { get: () => "application/json" }, json: async () => body, text: async () => JSON.stringify(body) };
}

/** 매칭되지 않은 요청(예: 페이지 본문 보강, 자유 폴백)은 빈 성공 응답으로 흡수한다. */
function stubFetch(handlers) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const href = typeof url === "string" ? url : url.toString();
    calls.push(href);
    for (const [pattern, respond] of handlers) {
      if (href.includes(pattern)) return respond();
    }
    return { ok: true, headers: { get: () => null }, json: async () => ({}), text: async () => "" };
  };
  return calls;
}

function requireBundle(t) {
  if (internetSearch) return true;
  t.skip("esbuild 를 사용할 수 없어 internet-search 번들을 만들지 못했습니다.");
  return false;
}

test("Tavily 와 Exa 를 병렬로 불러 결과를 합친다", async (t) => {
  if (!requireBundle(t)) return;
  globalThis.__ILJIN_RUNTIME_ENV__ = { TAVILY_API_KEY: "k1", EXA_API_KEY: "k2" };
  const calls = stubFetch([
    ["api.tavily.com", () => jsonResponse({
      results: [{ title: "Tavily 결과", url: "https://tavily-source.example/a", content: "타빌리 본문", score: 0.9 }],
    })],
    ["api.exa.ai", () => jsonResponse({
      results: [{ title: "Exa 결과", url: "https://exa-source.example/b", text: "엑사 의미 검색 본문", score: 0.88, publishedDate: "2026-08-01" }],
    })],
  ]);

  const response = await internetSearch.searchInternet("일진 AI 최신 동향", { principal, traceId: "TRC-1", limit: 8 });

  assert.ok(calls.some((url) => url.includes("api.tavily.com")));
  assert.ok(calls.some((url) => url.includes("api.exa.ai")), "Exa 를 Tavily 와 같은 배치에서 병렬로 호출해야 한다");
  assert.deepEqual(new Set(response.providersUsed), new Set(["tavily", "exa"]));
  assert.equal(new Set(response.results.map((r) => r.source)).size, 2, "서로 다른 두 출처가 모두 최종 결과에 남아야 한다");
});

test("첫 배치로 충분하면 다음 배치의 Provider는 부르지 않는다(비용 상한)", async (t) => {
  if (!requireBundle(t)) return;
  globalThis.__ILJIN_RUNTIME_ENV__ = {
    TAVILY_API_KEY: "k1", EXA_API_KEY: "k2",
    GOOGLE_SEARCH_API_KEY: "k3", GOOGLE_SEARCH_ENGINE_ID: "cx",
    BRAVE_SEARCH_API_KEY: "k4",
  };
  const many = (n) => Array.from({ length: n }, (_, i) => ({ title: `결과 ${i}`, url: `https://source.example/${i}`, content: "충분한 본문 내용", score: 0.8 - i * 0.01 }));
  const calls = stubFetch([
    ["api.tavily.com", () => jsonResponse({ results: many(6) })],
    ["api.exa.ai", () => jsonResponse({ results: many(6).map((r) => ({ ...r, text: r.content })) })],
    ["customsearch.googleapis.com", () => jsonResponse({ items: many(6).map((r) => ({ title: r.title, link: r.url, snippet: r.content })) })],
    ["api.search.brave.com", () => jsonResponse({ web: { results: many(6).map((r) => ({ title: r.title, url: r.url, description: r.content })) } })],
  ]);

  const response = await internetSearch.searchInternet("현재 환율", { principal, traceId: "TRC-2", limit: 8 });

  assert.ok(!calls.some((url) => url.includes("api.search.brave.com")), "3개짜리 첫 배치(Tavily·Exa·Google)로 충분하면 4번째 Provider(Brave)는 부르면 안 된다");
  assert.ok(response.results.length > 0);
});

test("첫 배치가 전부 실패해도 다음 배치(무료 폴백)로 계속 이어진다", async (t) => {
  if (!requireBundle(t)) return;
  globalThis.__ILJIN_RUNTIME_ENV__ = { TAVILY_API_KEY: "k1", EXA_API_KEY: "k2" };
  const ddgHtml = '<a class="result__a" href="https://ddg-source.example/x">DDG 결과 제목</a>'
    + '<span class="result__snippet">DDG 스니펫 내용입니다 검색 결과 본문입니다</span>';
  stubFetch([
    ["api.tavily.com", () => { throw new Error("network down"); }],
    ["api.exa.ai", () => { throw new Error("network down"); }],
    ["html.duckduckgo.com", () => ({ ok: true, headers: { get: () => "text/html" }, text: async () => ddgHtml })],
  ]);

  const response = await internetSearch.searchInternet("오늘 뉴스", { principal, traceId: "TRC-3", limit: 8 });

  assert.ok(response.fallbackUsed);
  assert.ok(response.providerPath.some((a) => a.provider === "tavily" && a.status === "failed"));
  assert.ok(response.providerPath.some((a) => a.provider === "exa" && a.status === "failed"));
  assert.equal(response.provider, "duckduckgo");
});

test("Wikimedia는 실시간 출처가 없을 때만 reference fallback으로 사용한다", async (t) => {
  if (!requireBundle(t)) return;
  globalThis.__ILJIN_RUNTIME_ENV__ = {};
  const ddgHtml = '<a class="result__a" href="https://live-source.example/x">실시간 출처</a>'
    + '<span class="result__snippet">현재 확인 가능한 실시간 검색 결과입니다.</span>';
  const calls = stubFetch([
    ["html.duckduckgo.com", () => ({ ok: true, headers: { get: () => "text/html" }, text: async () => ddgHtml })],
    ["wikipedia.org/w/api.php", () => jsonResponse({ query: { pages: [{ pageid: 1, title: "Wikipedia", fullurl: "https://ko.wikipedia.org/wiki/Test", extract: "백과사전 본문" }] } })],
  ]);

  const response = await internetSearch.searchInternet("현재 확인할 내용", { principal, traceId: "TRC-4", limit: 6 });

  assert.equal(response.provider, "duckduckgo");
  assert.ok(response.results.every((result) => result.source !== "ko.wikipedia.org"));
  assert.ok(!calls.some((url) => url.includes("wikipedia.org/w/api.php")));
});
