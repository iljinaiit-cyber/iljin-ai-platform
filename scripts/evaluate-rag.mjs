import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.BASE_URL || "http://localhost:3000";
const cases = JSON.parse(await readFile(new URL("../tests/golden-rag.json", import.meta.url), "utf8"));
const runId = randomUUID().replaceAll("-", "");
const principal = {
  "x-dev-user-email": `golden.admin.${runId}@iljin.e2e`,
  "x-dev-user-department": `GOLDEN-${runId.slice(0, 8)}`,
  "x-dev-user-role": "admin",
};
const assets = [];

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...principal, ...(options.headers || {}) },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

try {
  for (const item of cases) {
    const created = await request("/api/v1/assets", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        title: `${item.title} ${runId.slice(0, 6)}`,
        content: item.content,
        classification: "internal",
        departmentScope: [principal["x-dev-user-department"]],
      }),
    });
    assets.push({ ...item, assetId: created.assetId });
  }

  let recallHits = 0;
  let reciprocalRank = 0;
  let topCitationCorrect = 0;
  let faithful = 0;
  let contextPrecision = 0;
  let answerRelevant = 0;
  let verifierPassed = 0;
  for (const item of assets) {
    const search = await request("/api/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ query: item.query, limit: 10 }),
    });
    const rank = (search.citations || []).findIndex((citation) => citation.assetId === item.assetId);
    if (rank >= 0) {
      recallHits += 1;
      reciprocalRank += 1 / (rank + 1);
    }
    if (search.citations?.[0]?.assetId === item.assetId) topCitationCorrect += 1;
    const relevantCitations = (search.citations || []).filter((citation) => citation.assetId === item.assetId).length;
    contextPrecision += relevantCitations / Math.max((search.citations || []).length, 1);
    if (search.retrieval?.verifierStatus === "passed" && search.grounded) verifierPassed += 1;

    const chat = await request("/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ messages: [{ role: "user", content: item.query }], rag: true, stream: false }),
    });
    const answer = chat.choices?.[0]?.message?.content || "";
    const citesExpected = chat.citations?.some((citation) => citation.assetId === item.assetId);
    const relevantCase = item.expected_terms.some((term) => answer.includes(term));
    if (relevantCase) answerRelevant += 1;
    const faithfulCase = item.expected_terms.every((term) => answer.includes(term)) && /\[S\d+\]/.test(answer) && citesExpected;
    if (faithfulCase) faithful += 1;
    console.log(`[CASE] ${item.id} recall=${rank >= 0} rank=${rank + 1} citation=${citesExpected} verifier=${search.retrieval?.verifierStatus} relevant=${relevantCase} faithful=${faithfulCase}`);
    if (chat.conversation_id) {
      await request(`/api/v1/conversations/${encodeURIComponent(chat.conversation_id)}`, { method: "DELETE" });
    }
  }

  const total = assets.length;
  const metrics = {
    dataset_version: "starter-v2-rrf-verifier",
    cases: total,
    context_precision_at_10: contextPrecision / total,
    context_recall_at_10: recallHits / total,
    recall_at_10: recallHits / total,
    mrr: reciprocalRank / total,
    citation_correctness_at_1: topCitationCorrect / total,
    answer_relevancy_proxy: answerRelevant / total,
    faithfulness_proxy: faithful / total,
    evidence_verifier_pass_rate: verifierPassed / total,
  };
  console.log(JSON.stringify(metrics, null, 2));
  if (metrics.context_recall_at_10 < 0.90
    || metrics.citation_correctness_at_1 < 0.95
    || metrics.answer_relevancy_proxy < 0.95
    || metrics.faithfulness_proxy < 0.95
    || metrics.evidence_verifier_pass_rate < 0.95) {
    throw new Error(`Golden Gate 미달: ${JSON.stringify(metrics)}`);
  }
  console.log("[PASS] Starter Golden RAG Gate 통과");
} finally {
  await Promise.allSettled(assets.map((asset) => request(`/api/v1/assets/${encodeURIComponent(asset.assetId)}`, { method: "DELETE" })));
}
