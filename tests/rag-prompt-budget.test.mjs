import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let rag;
let bundleDir;

before(async () => {
  const esbuild = await import("esbuild").catch(() => undefined);
  if (!esbuild) return;
  bundleDir = await mkdtemp(join(tmpdir(), "iljin-rag-prompt-"));
  const outfile = join(bundleDir, "rag.mjs");
  await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../lib/rag.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    outfile,
  });
  rag = await import(pathToFileURL(outfile).href);
});

after(async () => {
  if (bundleDir) await rm(bundleDir, { recursive: true, force: true });
});

function requireRag(t) {
  if (rag) return true;
  t.skip("esbuild를 사용할 수 없어 RAG 프롬프트 예산을 실행하지 못했습니다.");
  return false;
}

test("RAG 근거는 최종 단일 메시지 한도 내에서만 포함한다", (t) => {
  if (!requireRag(t)) return;
  const template = `${"지시문 ".repeat(500)}__RAG_EVIDENCE__\n질문:\n최근 질문을 유지합니다.`;
  const prompt = rag.fitRagPrompt(template, "근거 ".repeat(3_000));

  assert.ok(prompt.length <= 7_800);
  assert.match(prompt, /최근 질문을 유지합니다/);
  assert.doesNotMatch(prompt, /__RAG_EVIDENCE__/);
});

test("근거 부족 폴백은 최근 메시지부터 Gateway 컨텍스트 한도를 지킨다", (t) => {
  if (!requireRag(t)) return;
  const messages = Array.from({ length: 25 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `${index}: ${"내용".repeat(1_500)}`,
  }));
  const bounded = rag.boundFallbackMessages(messages);

  assert.ok(bounded.length <= 20);
  assert.ok(bounded.every((message) => message.content.length <= 7_800));
  assert.ok(bounded.reduce((total, message) => total + message.content.length, 0) <= 16_000);
  assert.match(bounded.at(-1).content, /^24:/);
});
