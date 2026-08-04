import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("defines five non-destructive security negative controls", async () => {
  const corpus = JSON.parse(await readFile(new URL("qa/security-negative-corpus.json", root), "utf8"));
  assert.deepEqual(corpus.cases.map((item) => item.id), [
    "SEC-ACL-SPOOF-001",
    "SEC-PROMPT-001",
    "SEC-APPROVAL-001",
    "SEC-IDEMPOTENCY-001",
    "SEC-RATE-001",
  ]);
  assert.ok(corpus.cases.every((item) => item.expected && item.attack));
});

test("defines a 150-user load profile with contractual thresholds", async () => {
  const profile = await readFile(new URL("qa/load/k6-150-users.js", root), "utf8");
  const vus = [...profile.matchAll(/\bvus:\s*(\d+)/g)].map((match) => Number(match[1]));
  assert.equal(vus.reduce((sum, value) => sum + value, 0), 150);
  assert.match(profile, /qa_search_duration:[^\n]+p\(95\)<2000/);
  assert.match(profile, /qa_first_token_duration:[^\n]+p\(95\)<3000/);
  assert.match(profile, /qa_rag_duration:[^\n]+p\(95\)<8000/);
  assert.match(profile, /http_req_failed:\s*\["rate<0\.01"\]/);
  assert.match(profile, /QA_USER_POOL must contain at least 150 unique users/);
});

test("keeps DR claims evidence-backed", async () => {
  const checklist = JSON.parse(await readFile(new URL("qa/dr-rehearsal.checklist.json", root), "utf8"));
  assert.equal(checklist.controls.length, 9);
  assert.ok(checklist.controls.every((control) => control.status === "not_evidenced"));
  assert.ok(checklist.controls.some((control) => control.id === "DR-ISOLATED-RESTORE"));
  assert.ok(checklist.controls.some((control) => control.id === "DR-RPO-RTO"));
  assert.ok(checklist.controls.some((control) => control.id === "DR-SIGNOFF"));
});

test("separates G1 and G2 and does not promote the starter dataset", async () => {
  const [manifest, packageJson, starter] = await Promise.all([
    readFile(new URL("qa/gates.manifest.json", root), "utf8").then(JSON.parse),
    readFile(new URL("package.json", root), "utf8").then(JSON.parse),
    readFile(new URL("tests/golden-rag.json", root), "utf8").then(JSON.parse),
  ]);
  const cases = Array.isArray(starter) ? starter : starter.cases;
  assert.deepEqual(manifest.gates.map((gate) => gate.id), ["G1", "G2", "G3", "G4", "G5"]);
  assert.equal(manifest.policy.starter_dataset_is_official, false);
  assert.ok(cases.length <= manifest.policy.official_g2_minimum_cases);
  assert.notEqual(packageJson.scripts["test:rag:g1"], packageJson.scripts["test:rag:g2"]);
  assert.match(packageJson.scripts["test:rag:g1"], /verify-g1\.mjs/);
  assert.match(packageJson.scripts["test:rag:g2"], /verify-g2\.mjs/);
});
