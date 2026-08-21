import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const {
  annotateCitationIssues,
  isCitationReportBetter,
  needsCitationRepair,
  needsCitationWarning,
  verifyCitations,
} = await import("../lib/citation-guard.ts");

const EVIDENCE = [
  { id: "S1", content: "설비 정기점검은 분기마다 1회 실시하며 설비관리팀장이 결과를 승인한다." },
  { id: "S2", content: "품질 불량률이 2%를 초과하면 라인을 정지하고 원인 조사를 개시한다." },
];

// 인용 표기를 뗀 주장 본문만 임베딩 대상이어야 한다. 예상 밖의 텍스트가 오면
// 검증 대상이 어긋난 것이므로 폴백으로 조용히 넘어가지 않고 테스트를 실패시킨다.
const fakeEmbed = (vectorByText) => async (texts) => texts.map((text) => {
  const vector = vectorByText.get(text);
  assert.ok(vector, `임베딩 요청에 예상치 못한 텍스트가 포함됨: ${JSON.stringify(text)}`);
  return vector;
});

test("의미가 통하면 어휘가 겹치지 않아도 근거 있는 인용으로 인정한다", async () => {
  const report = await verifyCitations(
    "점검 주기는 3개월 단위이며 최종 확인은 팀 책임자가 맡습니다. [S1]",
    EVIDENCE,
    fakeEmbed(new Map([
      ["점검 주기는 3개월 단위이며 최종 확인은 팀 책임자가 맡습니다.", [1, 0.05, 0]],
      [EVIDENCE[0].content, [0.98, 0.2, 0]],
    ])),
  );

  assert.equal(report.support_mode, "semantic");
  assert.deepEqual(report.issues.filter((issue) => issue.kind === "unsupported_claim"), []);
});

test("어휘 중복 방식이었다면 같은 문장이 미근거로 오판된다", async () => {
  const report = await verifyCitations("점검 주기는 3개월 단위이며 최종 확인은 팀 책임자가 맡습니다. [S1]", EVIDENCE);

  assert.equal(report.support_mode, "lexical");
  assert.equal(report.issues.filter((issue) => issue.kind === "unsupported_claim").length, 1);
});

test("의미가 다른 근거를 인용하면 미근거로 표시한다", async () => {
  const report = await verifyCitations(
    "불량률 기준은 5%이며 라인 정지 없이 계속 생산합니다. [S1]",
    EVIDENCE,
    fakeEmbed(new Map([
      ["불량률 기준은 5%이며 라인 정지 없이 계속 생산합니다.", [0, 1, 0]],
      [EVIDENCE[0].content, [1, 0, 0]],
    ])),
  );

  const unsupported = report.issues.filter((issue) => issue.kind === "unsupported_claim");
  assert.equal(unsupported.length, 1);
  assert.match(unsupported[0].detail, /의미 유사도/);
});

test("임베딩이 실패하면 어휘 중복 검증으로 내려간다", async () => {
  const report = await verifyCitations("설비 정기점검은 분기마다 1회 실시한다. [S1]", EVIDENCE, async () => {
    throw new Error("EMBEDDING_UNAVAILABLE");
  });

  assert.equal(report.support_mode, "lexical");
  assert.deepEqual(report.issues.filter((issue) => issue.kind === "unsupported_claim"), []);
  // 종결부호 뒤의 [S1]이 앞 문장에 되붙어야 주장이 인용된 것으로 집계된다.
  assert.equal(report.factual_sentence_count, 1);
  assert.equal(report.cited_sentence_count, 1);
});

test("제공되지 않은 근거 ID는 임베딩 대상에서 제외하고 phantom으로 처리한다", async () => {
  const report = await verifyCitations("설비 정기점검은 분기마다 1회 실시한다. [S9]", EVIDENCE, async () => {
    throw new Error("임베딩이 호출되면 안 된다");
  });

  assert.equal(report.ok, false);
  assert.equal(report.issues.filter((issue) => issue.kind === "phantom_citation").length, 1);
  assert.match(annotateCitationIssues("설비 정기점검은 분기마다 1회 실시한다. [S9]", report), /근거 검증 경고/);
});

test("웹 검색 인용도 내부 문서와 같은 주장-근거 규칙으로 검사한다", async () => {
  const report = await verifyCitations(
    "산업용 AI 도입 기업은 생산성 향상을 보고했습니다. [W1]",
    [{ id: "W1", content: "산업용 AI 도입 기업은 생산성 향상을 보고했다." }],
  );

  assert.equal(report.issues.filter((issue) => issue.kind === "phantom_citation").length, 0);
  assert.equal(report.cited_sentence_count, 1);
});

test("인용이 조금 빠진 정도로는 재작성을 돌리지 않는다", () => {
  const mildlyUncited = {
    ok: false,
    citation_coverage: 0.67,
    factual_sentence_count: 3,
    cited_sentence_count: 2,
    support_mode: "semantic",
    issues: [{ kind: "uncited_claim", sentence: "담당자는 점검표를 보관합니다.", detail: "" }],
    unused_citation_ids: [],
  };

  assert.equal(needsCitationWarning(mildlyUncited), true, "경고는 붙어야 한다");
  assert.equal(needsCitationRepair(mildlyUncited), false, "추가 LLM 호출까지 갈 문제는 아니다");
});

test("없는 근거를 지어냈거나 근거와 어긋난 답변은 재작성 대상이다", () => {
  const base = {
    ok: false,
    citation_coverage: 1,
    factual_sentence_count: 2,
    cited_sentence_count: 2,
    support_mode: "semantic",
    unused_citation_ids: [],
  };

  assert.equal(needsCitationRepair({ ...base, issues: [{ kind: "phantom_citation", sentence: "", detail: "" }] }), true);
  assert.equal(needsCitationRepair({ ...base, issues: [{ kind: "unsupported_claim", sentence: "", detail: "" }] }), true);
  assert.equal(needsCitationRepair({ ...base, citation_coverage: 0.4, issues: [] }), true);
  assert.equal(needsCitationRepair({ ...base, issues: [] }), false);
});

test("재작성본은 지적이 줄었을 때만, 같으면 커버리지가 높을 때만 채택한다", () => {
  const report = (issueCount, coverage) => ({
    ok: false,
    citation_coverage: coverage,
    factual_sentence_count: 4,
    cited_sentence_count: 4,
    support_mode: "semantic",
    issues: Array.from({ length: issueCount }, () => ({ kind: "uncited_claim", sentence: "", detail: "" })),
    unused_citation_ids: [],
  });

  assert.equal(isCitationReportBetter(report(1, 0.9), report(3, 0.9)), true);
  assert.equal(isCitationReportBetter(report(3, 0.9), report(1, 0.9)), false);
  assert.equal(isCitationReportBetter(report(2, 0.95), report(2, 0.7)), true);
  assert.equal(isCitationReportBetter(report(2, 0.7), report(2, 0.7)), false, "동률이면 원본을 유지한다");
});

test("rag.ts는 재작성 결과를 재검증하고 더 나을 때만 교체한다", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");

  assert.match(source, /needsCitationRepair\(initialReport\)/);
  assert.match(source, /repairCitedAnswer/);
  assert.match(source, /isCitationReportBetter\(repairedReport, input\.report\)/);
  assert.match(source, /CITATION_REPAIR_MIN_LENGTH_RATIO/);
  assert.match(source, /rag-citation-repaired/);
  assert.match(source, /mergeCompletionUsage\(input\.completion, repaired\)/);
});

test("질의 유형이 답변 프롬프트의 골격을 결정한다", async () => {
  const source = await readFile(new URL("lib/rag.ts", root), "utf8");

  assert.match(source, /queryTypeInstructions: Record<RagQueryPlan\["type"\], string>/);
  assert.match(source, /queryTypeInstructions\[search\.retrieval\.queryType\]/);
  assert.match(source, /질의 유형\(비교\)/);
  assert.match(source, /질의 유형\(절차\)/);
  assert.match(source, /질의 유형\(복합\)/);
  assert.match(source, /질의 유형\(단순 조회\)/);
});
