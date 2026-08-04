#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { argument, hasFlag, projectRoot, summaryStatus, writeReport } from "./qa-utils.mjs";

const [layout, portal, agentOperations, css] = await Promise.all([
  readFile(path.join(projectRoot, "app/layout.tsx"), "utf8"),
  readFile(path.join(projectRoot, "app/AgentPortal.tsx"), "utf8"),
  readFile(path.join(projectRoot, "app/components/AgentOperations.tsx"), "utf8"),
  readFile(path.join(projectRoot, "app/globals.css"), "utf8"),
]);
const checks = [];
function check(id, condition, detail) {
  checks.push({ id, status: condition ? "pass" : "fail", detail });
}

check("A11Y-LANG", /<html lang="ko">/.test(layout), "Document language is declared as Korean.");
const hasApprovalDialog = /role="dialog"[^>]*approval/i.test(portal);
const dialogAccessible = !hasApprovalDialog || (/aria-modal="true"/.test(portal) && /aria-labelledby=/.test(portal));
const dialogFocusSafe = !hasApprovalDialog || (/event\.key !== "Tab"/.test(portal) && /previous\?\.focus\(\)/.test(portal) && /event\.key === "Escape"/.test(portal));
const hasInlineApprovalConfirmation = /type="checkbox"/.test(agentOperations)
  && /영향 범위와 외부 변경 여부를 확인했습니다/.test(agentOperations)
  && /!confirmed\[approval\.id\]/.test(agentOperations);
check("A11Y-APPROVAL", dialogAccessible && (hasApprovalDialog || hasInlineApprovalConfirmation), "Approval uses an accessible modal or an explicitly confirmed in-page control.");
check("A11Y-FOCUS", dialogFocusSafe, hasApprovalDialog ? "Dialog traps/restores focus and supports Escape." : "Approval is in-page, so no modal focus trap is required.");
check("A11Y-LIVE", /aria-live="polite"/.test(portal), "Asynchronous access state exposes a polite live region.");
check("RESPONSIVE-BREAKPOINTS", ["1080px", "700px", "420px"].every((value) => css.includes(`max-width: ${value}`)), "Desktop, tablet and mobile breakpoints exist.");
check("RESPONSIVE-TOUCH", /min-height:\s*44px/.test(css), "Interactive controls include a 44px minimum target.");
check("A11Y-MOTION", /prefers-reduced-motion:\s*reduce/.test(css), "Reduced-motion preferences are honored.");
check("RESPONSIVE-DYNAMIC-VIEWPORT", /100dvh/.test(css), "Dynamic viewport units protect mobile browser layouts.");

if (hasFlag("live")) {
  const baseUrl = argument("base-url", process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  try {
    const response = await fetch(`${baseUrl}/`, { headers: { Accept: "text/html" } });
    const html = await response.text();
    check("BROWSER-HTTP", response.status === 200 && /text\/html/.test(response.headers.get("content-type") || ""), `Portal returned HTTP ${response.status}.`);
    check("BROWSER-VIEWPORT", /<meta[^>]+name=["']viewport["']/i.test(html), "Rendered HTML includes the viewport metadata.");
    check("BROWSER-TITLE", /<title>[^<]*ILJIN AI Works/i.test(html), "Rendered HTML includes the product title.");
    check("BROWSER-LANG", /<html[^>]+lang=["']ko["']/i.test(html), "Rendered HTML preserves lang=ko.");
  } catch (error) {
    check("BROWSER-LIVE", false, error instanceof Error ? error.message : String(error));
  }
}

const report = {
  suite: "browser-accessibility-scaffold",
  mode: hasFlag("live") ? "live-ssr" : "static",
  generated_at: new Date().toISOString(),
  status: summaryStatus(checks),
  checks,
  limitation: "This dependency-free scaffold does not replace Playwright browser matrices, axe, screen-reader or visual-regression testing.",
};
const target = await writeReport(argument("output", "qa/results/browser-accessibility.json"), report);
console.log(`[${report.status.toUpperCase()}] browser/accessibility ${report.mode}: ${target}`);
if (report.status !== "pass") process.exitCode = 1;
