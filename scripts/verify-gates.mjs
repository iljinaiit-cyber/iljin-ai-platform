#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { argument, hasFlag, projectRoot, writeReport } from "./qa-utils.mjs";

const manifest = JSON.parse(await readFile(path.join(projectRoot, "qa/gates.manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const starter = JSON.parse(await readFile(path.join(projectRoot, "tests/golden-rag.json"), "utf8"));
const starterCases = Array.isArray(starter) ? starter : starter.cases || [];
const errors = [];
const expectedIds = ["G1", "G2", "G3", "G4", "G5"];

if (manifest.schema_version !== "1.0") errors.push("Unsupported manifest schema");
if (manifest.gates?.map((gate) => gate.id).join(",") !== expectedIds.join(",")) errors.push("Manifest must contain G1 through G5 in order");
if (packageJson.scripts?.["test:rag:g1"] === packageJson.scripts?.["test:rag:g2"]) errors.push("G1 and G2 npm scripts must be distinct");
if (!packageJson.scripts?.["test:rag:g1"]?.includes("verify-g1.mjs")) errors.push("G1 npm script must call verify-g1.mjs");
if (!packageJson.scripts?.["test:rag:g2"]?.includes("verify-g2.mjs")) errors.push("G2 npm script must call verify-g2.mjs");
if (manifest.policy?.starter_dataset_is_official !== false) errors.push("Starter dataset must not be marked official");
if (starterCases.length >= manifest.policy.official_g2_minimum_cases) errors.push("Starter dataset metadata is stale; promote it through an approved dataset process");

for (const gate of manifest.gates || []) {
  if (!["pass", "hold", "not_ready"].includes(gate.decision)) errors.push(`${gate.id}: invalid decision`);
  if (!Array.isArray(gate.manual_evidence_required) || gate.manual_evidence_required.length === 0) errors.push(`${gate.id}: manual evidence requirements missing`);
  for (const evidence of gate.automated_evidence || []) {
    try { await access(path.join(projectRoot, evidence)); } catch { errors.push(`${gate.id}: evidence path not found: ${evidence}`); }
  }
}

const decisions = Object.fromEntries((manifest.gates || []).map((gate) => [gate.id, gate.decision]));
const report = {
  suite: "gate-manifest",
  generated_at: new Date().toISOString(),
  validation_status: errors.length ? "fail" : "pass",
  release_decision: Object.values(decisions).every((decision) => decision === "pass") ? "approved" : "not_approved",
  decisions,
  starter_case_count: starterCases.length,
  official_g2_minimum_cases: manifest.policy?.official_g2_minimum_cases,
  errors,
};
const target = await writeReport(argument("output", "qa/results/gate-summary.json"), report);
console.log(`[${report.validation_status.toUpperCase()}] Gate manifest; release=${report.release_decision}: ${target}`);
if (errors.length || (hasFlag("strict") && report.release_decision !== "approved")) process.exitCode = 1;
