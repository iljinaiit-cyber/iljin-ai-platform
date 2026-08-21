import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("work Agent templates use the RAG drafting tool and display its result", async () => {
  const [portal, operations, orchestrator] = await Promise.all([
    readFile(new URL("../app/AgentPortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AgentOperations.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/agent-orchestrator.ts", import.meta.url), "utf8"),
  ]);

  assert.match(portal, /label: "업무 Agent"/);
  assert.match(operations, /WORK_AGENT_TEMPLATES/);
  assert.match(operations, /id: "meeting"/);
  assert.match(operations, /toolInput = selectedTool\.id === "knowledge\.search"/);
  assert.match(operations, /selectedTool\.id === "work\.assistant"/);
  assert.match(operations, /agent-run-result/);
  assert.match(portal, /agentRunForItem/);
  assert.match(portal, /agentRunResultSummary/);
  assert.match(portal, /Agent · \{agentRunStatusLabels/);
  assert.match(portal, /activeAgentCount/);
  assert.match(portal, /onSelectedWorkItemIdChange/);
  assert.match(portal, /schedule-alert" role="alert"/);
  assert.match(orchestrator, /kind: "execution",\s+status: "in_progress",\s+sourceType: "agent_run"/);
  assert.match(orchestrator, /id: "work\.assistant"/);
  assert.match(orchestrator, /completeWithRag\(/);
  assert.match(orchestrator, /answer: result\.completion\.content/);
});
