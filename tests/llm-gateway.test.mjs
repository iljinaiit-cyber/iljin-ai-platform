// LLM Gateway 동작 테스트.
//
// 이 저장소의 다른 테스트 대부분은 소스 문자열을 정규식으로 확인한다. 게이트웨이는
// "Provider 가 이렇게 응답하면 사용자에게 무엇이 가도록 되어 있는가"가 핵심이므로
// 실제로 실행해서 검증한다. TypeScript 소스를 esbuild 로 번들한 뒤 AI 바인딩과
// D1 을 가짜로 물려 호출한다.
//
// 회귀 대상: 2026-08-10 채팅 전면 실패
// (EMPTY_PROVIDER_RESPONSE → LOCAL_PROVIDER_NOT_CONFIGURED).
// glm-4.7-flash 는 사고(reasoning)가 기본 활성이고 사고 토큰이 max_tokens 예산을
// 먹는다. tier 상한 안에서 사고가 예산을 다 쓰면 본문이 빈 채로 응답이 온다.
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MODEL = "@cf/zai-org/glm-4.7-flash";
const TIER_MAX_TOKENS = 1_200;
const REASONING_HEADROOM = 1_024;

let gateway;
let bundleDir;

before(async () => {
  // esbuild 는 vite 를 통해 들어오는 전이 의존성이다. 없으면 테스트를 건너뛴다.
  const esbuild = await import("esbuild").catch(() => undefined);
  if (!esbuild) return;
  bundleDir = await mkdtemp(join(tmpdir(), "iljin-gateway-"));
  const outfile = join(bundleDir, "llm-gateway.mjs");
  await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../lib/llm-gateway.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    outfile,
  });
  gateway = await import(pathToFileURL(outfile).href);
});

after(async () => {
  if (bundleDir) await rm(bundleDir, { recursive: true, force: true });
});

const fakeDb = {
  prepare() {
    return {
      bind() { return this; },
      run: async () => ({ meta: { changes: 1 } }),
      first: async () => null,
      all: async () => ({ results: [] }),
    };
  },
};

/** AI 바인딩을 가짜 응답으로 바꾸고, 실제 전달된 입력을 기록한다. */
function stubProvider(respond) {
  const calls = [];
  globalThis.__ILJIN_RUNTIME_ENV__ = {
    DB: fakeDb,
    AI: {
      run: async (model, input) => {
        calls.push({ model, input });
        return respond(calls.length - 1, input);
      },
    },
    CLOUDFLARE_AI_MODEL: MODEL,
    MAX_EGRESS_SENSITIVITY: "internal",
    LLM_TIMEOUT_MS: "5000",
  };
  // 회로 차단기는 모듈 전역이다. 테스트 간 실패 누적을 끊는다.
  gateway.resetProviderCircuit("cloudflare");
  gateway.resetProviderCircuit("local");
  return calls;
}

function ask() {
  return gateway.completeWithGateway(
    [{ role: "user", content: "Document RAG 단계별 구축 전략을 요약해줘." }],
    "TRC-TEST",
    { sensitivity: "internal", maxOutputTokens: TIER_MAX_TOKENS },
    "expert",
  );
}

const answer = (content, extra = {}) => ({
  model: MODEL,
  choices: [{ finish_reason: "stop", message: { role: "assistant", content, ...extra } }],
});

const truncatedThinking = () => ({
  model: MODEL,
  choices: [{ finish_reason: "length", message: { role: "assistant", content: "" } }],
  usage: { prompt_tokens: 10, completion_tokens: TIER_MAX_TOKENS, completion_tokens_details: { reasoning_tokens: TIER_MAX_TOKENS } },
});

function requireGateway(t) {
  if (gateway) return true;
  t.skip("esbuild 를 사용할 수 없어 게이트웨이 번들을 만들지 못했습니다.");
  return false;
}

test("Cloudflare 채팅 호출은 사고를 끈 채 나간다", async (t) => {
  if (!requireGateway(t)) return;
  const calls = stubProvider(() => answer("요약입니다."));
  const completion = await ask();

  assert.equal(completion.content, "요약입니다.");
  assert.equal(calls.length, 1, "성공한 요청은 한 번만 호출한다");
  assert.deepEqual(calls[0].input.chat_template_kwargs, { enable_thinking: false });
  assert.equal(calls[0].input.max_tokens, TIER_MAX_TOKENS);
});

test("빈 응답은 상한을 올려 한 번만 재시도하고 포기한다", async (t) => {
  if (!requireGateway(t)) return;
  const calls = stubProvider(truncatedThinking);
  const error = await ask().then(() => undefined, (caught) => caught);

  assert.ok(error, "빈 응답이 이어지면 오류가 나야 한다");
  assert.equal(calls.length, 2, "같은 요청을 세 번 태우면 실패는 그대로인 채 비용만 는다");
  assert.equal(calls[0].input.max_tokens, TIER_MAX_TOKENS);
  assert.equal(calls[1].input.max_tokens, TIER_MAX_TOKENS + REASONING_HEADROOM);
  assert.equal(error.code, "ALL_PROVIDERS_UNAVAILABLE");
});

test("2차 시도가 성공하면 그 답변을 돌려준다", async (t) => {
  if (!requireGateway(t)) return;
  const calls = stubProvider((index) => (index === 0 ? truncatedThinking() : answer("두 번째 시도 답변")));
  const completion = await ask();

  assert.equal(completion.content, "두 번째 시도 답변");
  assert.equal(calls.length, 2);
});

test("사고 필드에만 남은 답변은 오류 대신 구제한다", async (t) => {
  if (!requireGateway(t)) return;
  stubProvider(() => answer(null, { reasoning_content: "사고 필드에만 남은 답변" }));

  assert.equal((await ask()).content, "사고 필드에만 남은 답변");
});

test("<think> 블록은 답변에서 제거된다", async (t) => {
  if (!requireGateway(t)) return;
  stubProvider(() => answer("<think>이건 사고 과정</think>\n\n실제 답변입니다."));

  assert.equal((await ask()).content, "실제 답변입니다.");
});

test("닫히지 않은 <think> 뒤 내용은 사용자에게 나가지 않는다", async (t) => {
  if (!requireGateway(t)) return;
  stubProvider(() => answer("앞부분 답변\n<think>잘린 사고 과정…"));

  assert.equal((await ask()).content, "앞부분 답변");
});

test("두 Provider 가 모두 실패하면 원인과 다음 행동을 담은 문장을 준다", async (t) => {
  if (!requireGateway(t)) return;
  stubProvider(truncatedThinking);
  const error = await ask().then(() => undefined, (caught) => caught);

  // 종전에는 코드만 노출했다. 사용자는 무엇을 해야 할지 알 수 없었고,
  // 로컬이 구성되지 않은 배포에서는 "로컬이 응답하지 않는다"가 사실도 아니었다.
  assert.match(error.message, /본문 없는 응답/);
  assert.match(error.message, /답변 분량을 줄이거나/);
  assert.match(error.message, /로컬 LLM은 이 환경에 구성되어 있지 않습니다/);
  assert.match(error.message, /EMPTY_PROVIDER_RESPONSE → LOCAL_PROVIDER_NOT_CONFIGURED/);
});
