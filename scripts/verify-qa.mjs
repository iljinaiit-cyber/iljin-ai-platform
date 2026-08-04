#!/usr/bin/env node
import process from "node:process";
import { argument, hasFlag, runNode, writeReport } from "./qa-utils.mjs";

const live = hasFlag("live");
const strict = hasFlag("strict");
const baseUrl = argument("base-url", process.env.BASE_URL);
const common = [];
if (live) common.push("--live");
if (baseUrl) common.push("--base-url", baseUrl);

const suites = [
  ["browser-accessibility", "scripts/verify-browser-accessibility.mjs", common],
  ["security-negative", "scripts/verify-security-negative.mjs", common],
  ["dr-rehearsal", "scripts/verify-dr-rehearsal.mjs", []],
  ["g1", "scripts/verify-g1.mjs", common],
  ["g2", "scripts/verify-g2.mjs", common],
  ["gate-manifest", "scripts/verify-gates.mjs", strict ? ["--strict"] : []],
];
const results = [];
for (const [name, script, args] of suites) {
  const child = runNode(script, args);
  results.push({ name, status: child.status === 0 ? "pass" : "fail", exit_code: child.status });
}

const report = {
  suite: "qa-gate-orchestrator",
  generated_at: new Date().toISOString(),
  mode: live ? "live" : "static",
  strict,
  execution_status: results.every((item) => item.status === "pass") ? "pass" : "fail",
  production_release: "not_approved",
  results,
  note: "A passing advisory run validates the QA package; it does not override HOLD/NOT_READY Gate decisions.",
};
const target = await writeReport("qa/results/qa-run.json", report);
console.log(`[${report.execution_status.toUpperCase()}] QA orchestrator; production=${report.production_release}: ${target}`);
if (report.execution_status !== "pass") process.exitCode = 1;
