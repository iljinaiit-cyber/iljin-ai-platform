#!/usr/bin/env node
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { argument, hasFlag, projectRoot, runNode, writeReport } from "./qa-utils.mjs";

const automatedEvidence = [
  "scripts/verify-platform.mjs",
  "app/api/v1/assets/route.ts",
  "app/api/v1/search/route.ts",
  "lib/rag.ts",
  "docs/openapi.yaml",
];
const checks = [];
for (const evidence of automatedEvidence) {
  try {
    await access(path.join(projectRoot, evidence));
    checks.push({ id: `FILE:${evidence}`, status: "pass" });
  } catch {
    checks.push({ id: `FILE:${evidence}`, status: "fail" });
  }
}

let liveLifecycle = "not_run";
if (hasFlag("live")) {
  const args = [];
  const baseUrl = argument("base-url", process.env.BASE_URL);
  if (baseUrl) args.push("--base-url", baseUrl);
  liveLifecycle = runNode("scripts/verify-platform.mjs", args).status === 0 ? "pass" : "fail";
}

const missingOfficialEvidence = [
  "approved data-source scale survey",
  "STT WER/CER benchmark and target",
  "versioned NDCG@10 benchmark",
  "per-query cost ceiling and measured distribution",
  "embedding-model comparison using the same evaluation set",
];
const automatedStatus = checks.every((item) => item.status === "pass") && liveLifecycle !== "fail" ? "pass" : "fail";
const report = {
  gate: "G1",
  generated_at: new Date().toISOString(),
  automated_status: automatedStatus,
  live_lifecycle: liveLifecycle,
  official_decision: "hold",
  checks,
  missing_official_evidence: missingOfficialEvidence,
  statement: "A passing text-platform lifecycle is development evidence only and does not approve G1.",
};
const target = await writeReport(argument("output", "qa/results/g1.json"), report);
console.log(`[${automatedStatus.toUpperCase()}] G1 automated; official=HOLD: ${target}`);
if (automatedStatus !== "pass" || (hasFlag("strict") && report.official_decision !== "pass")) process.exitCode = 1;
