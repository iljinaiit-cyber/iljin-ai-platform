#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { argument, hasFlag, projectRoot, runNode, writeReport } from "./qa-utils.mjs";

const starter = JSON.parse(await readFile(path.join(projectRoot, "tests/golden-rag.json"), "utf8"));
const cases = Array.isArray(starter) ? starter : starter.cases || [];
const [rag, searchRoute, citationRoute] = await Promise.all([
  readFile(path.join(projectRoot, "lib/rag.ts"), "utf8"),
  readFile(path.join(projectRoot, "app/api/v1/search/route.ts"), "utf8"),
  readFile(path.join(projectRoot, "app/api/v1/citations/route.ts"), "utf8"),
]);
const checks = [
  { id: "G2-STARTER-DATASET-PARSES", status: cases.length > 0 ? "pass" : "fail", observed: cases.length },
  { id: "G2-ACL-SERVER-FILTER", status: /department_scope/.test(rag) && /resolvePrincipal/.test(searchRoute) ? "pass" : "fail" },
  { id: "G2-CITATION-REVALIDATION", status: /resolvePrincipal/.test(citationRoute) && /getCitation/.test(citationRoute) ? "pass" : "fail" },
];

let liveStarterEvaluation = "not_run";
if (hasFlag("live")) {
  const args = [];
  const baseUrl = argument("base-url", process.env.BASE_URL);
  if (baseUrl) args.push("--base-url", baseUrl);
  liveStarterEvaluation = runNode("scripts/evaluate-rag.mjs", args).status === 0 ? "pass" : "fail";
}

const officialMinimum = 300;
const automatedStatus = checks.every((item) => item.status === "pass") && liveStarterEvaluation !== "fail" ? "pass" : "fail";
const report = {
  gate: "G2",
  generated_at: new Date().toISOString(),
  automated_status: automatedStatus,
  live_starter_evaluation: liveStarterEvaluation,
  starter_case_count: cases.length,
  official_minimum_case_count: officialMinimum,
  starter_only: cases.length < officialMinimum,
  official_decision: "hold",
  checks,
  missing_official_evidence: [
    "approved 300-case golden dataset",
    "enterprise IdP ACL negative set with zero leakage",
    "human or validated evaluator faithfulness and citation-correctness review",
  ],
  statement: "The three-case starter set and term/citation faithfulness proxy are not official G2 evidence.",
};
const target = await writeReport(argument("output", "qa/results/g2.json"), report);
console.log(`[${automatedStatus.toUpperCase()}] G2 automated starter=${cases.length}; official=HOLD: ${target}`);
if (automatedStatus !== "pass" || (hasFlag("strict") && report.official_decision !== "pass")) process.exitCode = 1;
