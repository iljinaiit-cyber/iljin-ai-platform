#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { argument, hasFlag, projectRoot, writeReport } from "./qa-utils.mjs";

const requiredIds = [
  "DR-D1-BACKUP",
  "DR-R2-BACKUP",
  "DR-CONFIG",
  "DR-ISOLATED-RESTORE",
  "DR-INTEGRITY",
  "DR-APP-SMOKE",
  "DR-RPO-RTO",
  "DR-ROLLBACK",
  "DR-SIGNOFF",
];
const checklistPath = path.resolve(projectRoot, argument("checklist", "qa/dr-rehearsal.checklist.json"));
const checklist = JSON.parse(await readFile(checklistPath, "utf8"));
const structuralErrors = [];

if (checklist.schema_version !== "1.0") structuralErrors.push("schema_version must be 1.0");
if (!Number.isFinite(checklist.targets?.rpo_minutes) || checklist.targets.rpo_minutes <= 0) structuralErrors.push("positive RPO target is required");
if (!Number.isFinite(checklist.targets?.rto_minutes) || checklist.targets.rto_minutes <= 0) structuralErrors.push("positive RTO target is required");
if (!Array.isArray(checklist.controls)) structuralErrors.push("controls must be an array");

const controls = Array.isArray(checklist.controls) ? checklist.controls : [];
for (const id of requiredIds) {
  if (!controls.some((control) => control.id === id)) structuralErrors.push(`missing control ${id}`);
}

for (const control of controls) {
  if (!["not_evidenced", "failed", "verified"].includes(control.status)) structuralErrors.push(`${control.id}: invalid status`);
  if (!Array.isArray(control.evidence)) structuralErrors.push(`${control.id}: evidence must be an array`);
  if (control.status === "verified" && control.evidence.length === 0) structuralErrors.push(`${control.id}: verified control has no evidence`);
  for (const evidence of control.evidence || []) {
    try { await access(path.resolve(projectRoot, evidence)); } catch { structuralErrors.push(`${control.id}: evidence file not found: ${evidence}`); }
  }
}

const verified = controls.filter((control) => control.status === "verified").length;
const readiness = structuralErrors.length === 0 && verified === requiredIds.length &&
  checklist.environment !== "not_recorded" && checklist.rehearsal_id !== "not_run" && checklist.executed_at && checklist.owner !== "unassigned"
  ? "ready" : "blocked";
const report = {
  suite: "dr-rehearsal",
  generated_at: new Date().toISOString(),
  validation_status: structuralErrors.length ? "fail" : "pass",
  readiness,
  target_rpo_minutes: checklist.targets?.rpo_minutes,
  target_rto_minutes: checklist.targets?.rto_minutes,
  verified_controls: verified,
  required_controls: requiredIds.length,
  structural_errors: structuralErrors,
  missing_evidence: controls.filter((control) => control.status !== "verified").map((control) => control.id),
};
const target = await writeReport(argument("output", "qa/results/dr-rehearsal.json"), report);
console.log(`[${report.validation_status.toUpperCase()}] DR checklist; readiness=${readiness}; evidence=${verified}/${requiredIds.length}: ${target}`);
if (structuralErrors.length || (hasFlag("strict") && readiness !== "ready")) process.exitCode = 1;
