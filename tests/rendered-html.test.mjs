import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function request(path = "/", runtimeEnv = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: path === "/" ? "text/html" : "application/json" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, ...runtimeEnv },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function render() {
  return request("/");
}

test("renders the ILJIN AI Works email login and approval gate", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<html[^>]+lang="ko"/i);
  assert.match(html, /ILJIN AI Works/);
  assert.match(html, /로그인 확인 중/);
  assert.match(html, /로그인 상태를 확인하고 있습니다/);
  assert.match(html, /access-gate-card/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("implements D1 email-password login and administrator approval before business API access", async () => {
  const [identity, portal, meRoute, registerRoute, loginRoute, logoutRoute, applicationRoute, approvalRoute, schema, migration] = await Promise.all([
    readFile(new URL("lib/identity.ts", root), "utf8"),
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/api/auth/me/route.ts", root), "utf8"),
    readFile(new URL("app/api/auth/register/route.ts", root), "utf8"),
    readFile(new URL("app/api/auth/login/route.ts", root), "utf8"),
    readFile(new URL("app/api/auth/logout/route.ts", root), "utf8"),
    readFile(new URL("app/api/auth/application/route.ts", root), "utf8"),
    readFile(new URL("app/api/admin/access-requests/route.ts", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("drizzle/0005_email_password_auth.sql", root), "utf8"),
  ]);
  assert.match(identity, /AUTH_APPROVAL_REQUIRED/);
  assert.match(identity, /AUTH_APPLICATION_REQUIRED/);
  assert.match(identity, /REGISTRATION_EMAIL_DOMAIN = "iljin\.com"/);
  assert.match(identity, /domain !== REGISTRATION_EMAIL_DOMAIN/);
  assert.match(identity, /AUTH_EMAIL_DOMAIN_NOT_ALLOWED/);
  assert.match(identity, /access\.requested/);
  assert.match(identity, /status = 'approved'/);
  assert.match(identity, /access\.approved/);
  assert.match(portal, /가입 승인 대기/);
  assert.match(portal, /가입 승인/);
  assert.match(portal, /이메일 가입 신청/);
  assert.match(portal, /registrationEmailAllowed/);
  assert.match(portal, /일진 임직원 이메일\(@iljin\.com\)만 가입할 수 있습니다/);
  assert.match(portal, /\/api\/auth\/login/);
  assert.match(portal, /\/api\/auth\/register/);
  assert.match(portal, /\/api\/auth\/logout/);
  assert.match(portal, /event\.persisted/);
  assert.doesNotMatch(portal, /ChatGPT|signin-with-chatgpt/i);
  assert.match(meRoute, /resolveAccessIdentity/);
  assert.match(registerRoute, /registerEmailAccount/);
  assert.match(registerRoute, /verificationUrl/);
  assert.doesNotMatch(registerRoute, /sessionCookie/);
  assert.match(identity, /email_verification_requests/);
  assert.match(identity, /RESEND_API_KEY/);
  assert.match(portal, /verificationRequired/);
  assert.match(loginRoute, /loginEmailAccount/);
  assert.match(logoutRoute, /expiredSessionCookie/);
  assert.match(applicationRoute, /submitAccessApplication/);
  assert.match(approvalRoute, /reviewAccessRequest/);
  assert.match(identity, /PBKDF2/);
  assert.match(identity, /HttpOnly.*SameSite=Lax/);
  const sessionCookieFactory = identity.match(/export function sessionCookie[\s\S]*?\n}/)?.[0] ?? "";
  assert.doesNotMatch(sessionCookieFactory, /Max-Age=/);
  assert.match(identity, /protocol === "https:"/);
  assert.match(identity, /ADMIN_BOOTSTRAP_TOKEN/);
  assert.match(schema, /approvalRequestedAt/);
  assert.match(schema, /applicationNote/);
  assert.match(schema, /approvedBy/);
  assert.match(schema, /authCredentials/);
  assert.match(schema, /authSessions/);
  assert.match(migration, /CREATE TABLE `auth_credentials`/);
  assert.match(migration, /CREATE TABLE `auth_sessions`/);
});

test("returns a recoverable configuration error when the authentication database binding is unavailable", async () => {
  const response = await request("/api/auth/me");
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "30");
  const payload = await response.json();
  assert.equal(payload.error.code, "RUNTIME_CONFIGURATION_REQUIRED");
  assert.equal(payload.error.retryable, true);
  assert.match(payload.error.trace_id, /^trc_/);
});

test("keeps required accessibility and responsive safeguards", async () => {
  const [page, app, agentOperations, layout, css, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/components/AgentOperations.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);
  assert.match(page, /<AgentPortal \/>/);
  assert.match(layout, /<html lang="ko">/);
  assert.match(app, /aria-live="polite"/);
  assert.match(agentOperations, /aria-live="polite"/);
  assert.match(agentOperations, /type="checkbox"/);
  assert.match(agentOperations, /영향 범위와 외부 변경 여부를 확인했습니다/);
  assert.match(agentOperations, /disabled=\{!confirmed\[approval\.id\]/);
  assert.match(css, /@media \(max-width: 1080px\)/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(app, /window\.setInterval\(updateClock, 1_000\)/);
  assert.match(app, /timeZone: "Asia\/Seoul"/);
  assert.match(app, /className="live-clock"/);
  assert.match(css, /\.live-clock/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /min-height:\s*44px/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("implements administrator governance for roles, users, features, and audit", async () => {
  const [governance, route, component, schema, migration, chatRoute, searchRoute, assetsRoute, agentRoute] = await Promise.all([
    readFile(new URL("lib/admin-governance.ts", root), "utf8"),
    readFile(new URL("app/api/admin/governance/route.ts", root), "utf8"),
    readFile(new URL("app/components/AdminGovernance.tsx", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("drizzle/0006_admin_governance.sql", root), "utf8"),
    readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8"),
    readFile(new URL("app/api/v1/search/route.ts", root), "utf8"),
    readFile(new URL("app/api/v1/assets/route.ts", root), "utf8"),
    readFile(new URL("app/api/v1/agent/runs/route.ts", root), "utf8"),
  ]);
  assert.match(governance, /PERMISSION_CATALOG/);
  assert.match(governance, /FEATURE_CATALOG/);
  assert.match(governance, /CORE_ADMIN_KEYS/);
  assert.match(governance, /마지막 관리자는 일반 역할로 변경할 수 없습니다/);
  assert.match(governance, /governance\.role_permission\.updated/);
  assert.match(route, /updateRolePermission/);
  assert.match(route, /updateUserPermission/);
  assert.match(route, /updateFeatureSetting/);
  assert.match(route, /updateManagedUser/);
  assert.match(component, /사용자별 권한/);
  assert.match(component, /역할 정책/);
  assert.match(component, /기능 설정/);
  assert.match(component, /변경 이력/);
  assert.match(schema, /rolePermissions/);
  assert.match(schema, /userPermissionOverrides/);
  assert.match(schema, /featureSettings/);
  assert.match(migration, /CREATE TABLE `role_permissions`/);
  assert.match(migration, /CREATE TABLE `user_permission_overrides`/);
  assert.match(migration, /CREATE TABLE `feature_settings`/);
  assert.match(chatRoute, /authorizeFeature\(principal, "ai\.chat", "ai\.chat"\)/);
  assert.match(searchRoute, /authorizeFeature\(principal, "rag\.search", "rag\.search"\)/);
  assert.match(assetsRoute, /authorizeFeature\(principal, "documents\.manage", "documents\.upload"\)/);
  assert.match(agentRoute, /authorizeFeature\(principal, "agent\.run", "agent"\)/);
});

test("implements evidence-backed AI Control Tower, SLO gate, and tenant-safe retrieval telemetry", async () => {
  const [tower, route, component, portal, schema, migration, rag, observability] = await Promise.all([
    readFile(new URL("lib/control-tower.ts", root), "utf8"),
    readFile(new URL("app/api/admin/control-tower/route.ts", root), "utf8"),
    readFile(new URL("app/components/AiControlTower.tsx", root), "utf8"),
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("drizzle/0007_ai_control_tower.sql", root), "utf8"),
    readFile(new URL("lib/rag.ts", root), "utf8"),
    readFile(new URL("app/api/admin/observability/route.ts", root), "utf8"),
  ]);
  assert.match(tower, /CONTROL_CATALOG/);
  assert.match(tower, /NIST AI RMF/);
  assert.match(tower, /OWASP LLM\/Agentic/);
  assert.match(tower, /OpenTelemetry GenAI/);
  assert.match(tower, /criticalGap/);
  assert.match(tower, /failedSlo/);
  assert.match(tower, /control\.assessment\.updated/);
  assert.match(tower, /control\.slo\.updated/);
  assert.match(route, /updateControlAssessment/);
  assert.match(route, /updateSloPolicy/);
  assert.match(component, /\/api\/admin\/readiness/);
  assert.match(component, /\/api\/admin\/providers/);
  assert.match(component, /\/api\/admin\/observability/);
  assert.match(component, /PRODUCTION GATE/);
  assert.match(portal, /<AiControlTower currentEmail=\{currentEmail\}/);
  assert.match(schema, /aiControlAssessments/);
  assert.match(schema, /aiSloPolicies/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `ai_control_assessments`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `ai_slo_policies`/);
  assert.match(rag, /\(id, tenant_id, owner_email, query_hash/);
  assert.match(observability, /WHERE tenant_id = \?/);
});

test("connects every workspace menu to durable activity, conversation, feedback, and quality APIs", async () => {
  const [portal, activity, activityRoute, conversations, feedback, quality, qualityRoute, rag, migration] = await Promise.all([
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("lib/activity.ts", root), "utf8"),
    readFile(new URL("app/api/v1/activity/route.ts", root), "utf8"),
    readFile(new URL("lib/conversations.ts", root), "utf8"),
    readFile(new URL("app/api/v1/messages/[id]/feedback/route.ts", root), "utf8"),
    readFile(new URL("lib/quality-gates.ts", root), "utf8"),
    readFile(new URL("app/api/admin/quality-gates/route.ts", root), "utf8"),
    readFile(new URL("lib/rag.ts", root), "utf8"),
    readFile(new URL("drizzle/0008_activity_owner.sql", root), "utf8"),
  ]);
  assert.match(portal, /\/api\/v1\/activity\?limit=8/);
  assert.match(portal, /활동 CSV 내보내기/);
  assert.match(portal, /onNewConversation/);
  assert.match(portal, /\/api\/v1\/conversations\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(portal, /\/api\/v1\/messages\/\$\{encodeURIComponent\(messageId\)\}\/feedback/);
  assert.match(portal, /문서 첨부/);
  assert.match(portal, /\/api\/admin\/quality-gates/);
  assert.match(activity, /getActivityDashboard/);
  assert.match(activity, /activityCsv/);
  assert.match(activityRoute, /text\/csv/);
  assert.match(conversations, /listConversations/);
  assert.match(feedback, /addFeedback/);
  assert.match(quality, /getQualityGates/);
  assert.match(qualityRoute, /QUALITY_GATE_READ_FAILED/);
  assert.match(rag, /owner_email/);
  assert.match(migration, /retrieval_traces_owner_created_idx/);
});

test("routes chat through Cloudflare GLM 4.7 Flash with local fallback", async () => {
  const [app, route, gateway, readiness, providersRoute, controlTower, telemetry, migration, resourceProbes, resourceMigration, envExample, wrangler] = await Promise.all([
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8"),
    readFile(new URL("lib/llm-gateway.ts", root), "utf8"),
    readFile(new URL("lib/readiness.ts", root), "utf8"),
    readFile(new URL("app/api/admin/providers/route.ts", root), "utf8"),
    readFile(new URL("app/components/AiControlTower.tsx", root), "utf8"),
    readFile(new URL("lib/llm-telemetry.ts", root), "utf8"),
    readFile(new URL("drizzle/0009_llm_invocation_telemetry.sql", root), "utf8"),
    readFile(new URL("lib/provider-resources.ts", root), "utf8"),
    readFile(new URL("drizzle/0012_provider_resource_probes.sql", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
    readFile(new URL("wrangler.jsonc", root), "utf8"),
  ]);
  assert.match(app, /fetch\("\/api\/v1\/chat\/completions"/);
  assert.match(app, /"X-Sensitivity": effectiveSensitivity/);
  assert.doesNotMatch(app, /window\.setTimeout/);
  assert.match(route, /completeWithGateway/);
  assert.match(gateway, /completeWithLocal/);
  assert.match(gateway, /openAiCompatibleBaseUrl/);
  assert.match(gateway, /LOCAL_LLM_TIMEOUT_MS/);
  assert.match(gateway, /think: false/);
  assert.doesNotMatch(gateway, /\/api\/chat/);
  assert.match(gateway, /completeWithCloudflare/);
  assert.match(gateway, /@cf\/zai-org\/glm-4\.7-flash/);
  assert.match(gateway, /\["cloudflare", "local"\]/);
  assert.match(gateway, /sensitivity === "confidential"/);
  assert.match(gateway, /CLOUDFLARE_RESIDENCY_POLICY_BLOCKED/);
  assert.match(gateway, /cloudflareAiRestBaseUrl/);
  assert.match(gateway, /LOCAL_LLM_ACCESS_CLIENT_SECRET/);
  assert.match(readiness, /openAiCompatibleBaseUrl/);
  assert.match(readiness, /probeCloudflareAi/);
  assert.match(readiness, /"\/models"/);
  assert.match(providersRoute, /resetProviderCircuit/);
  assert.match(providersRoute, /probeLocalLlm/);
  assert.match(providersRoute, /probeCloudflareAi/);
  assert.match(providersRoute, /probe_all/);
  assert.match(providersRoute, /recordProviderProbe/);
  assert.match(resourceProbes, /provider_resource_probes/);
  assert.match(resourceMigration, /CREATE TABLE IF NOT EXISTS `provider_resource_probes`/);
  assert.match(controlTower, /전체 연결 테스트/);
  assert.match(controlTower, /LLM 모델 리소스 연동/);
  assert.match(controlTower, /2단계 LLM 라우팅/);
  assert.match(controlTower, /Provider 사용량·폴백·지연/);
  assert.match(app, /공개 · 인터넷/);
  assert.match(app, /내부 · Cloudflare/);
  assert.match(app, /useState<ChatSensitivity>\("public"\)/);
  assert.match(app, /답변 복사/);
  assert.match(app, /답변 중단/);
  assert.match(app, /chat-smart-suggestions/);
  assert.match(app, /providerAvailability/);
  assert.match(app, /내부 검색/);
  assert.match(app, /인터넷 검색/);
  assert.match(app, /onDragEnter=\{handleDragEnter\}/);
  assert.match(route, /search_mode/);
  assert.match(route, /searchInternet/);
  assert.match(route, /resolveSensitivity/);
  assert.match(route, /CONVERSATION_SENSITIVITY_MISMATCH/);
  assert.match(route, /recordLlmInvocation/);
  assert.match(telemetry, /fallback_path_json/);
  assert.match(telemetry, /prompt_tokens/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `llm_invocations`/);
  assert.match(controlTower, /연결 테스트/);
  assert.match(controlTower, /Circuit 초기화/);
  assert.match(envExample, /vLLM example/);
  assert.match(envExample, /CLOUDFLARE_AI_MODEL=@cf\/zai-org\/glm-5\.2/);
  assert.match(envExample, /CLOUDFLARE_ACCOUNT_ID=/);
  assert.match(envExample, /CLOUDFLARE_API_TOKEN=/);
  assert.match(wrangler, /"binding": "AI"/);
  assert.doesNotMatch(envExample, /sk-[A-Za-z0-9_-]{20,}/);
});

test("removes the legacy external provider configuration", async () => {
  const [runtime, envExample] = await Promise.all([
    readFile(new URL("lib/runtime-env.ts", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
  ]);
  assert.match(runtime, /globalThis\.__ILJIN_RUNTIME_ENV__ = runtime/);
  assert.match(envExample, /CLOUDFLARE_EMBED_MODEL/);
});

test("reports server-only RAG capabilities without exposing secrets", async () => {
  const response = await request("/api/health", {
    DB: {},
    BUCKET: {},
    LOCAL_LLM_BASE_URL: "http://127.0.0.1:11434",
    LOCAL_LLM_MODEL: "gemma4:latest",
    AI: { run: async () => ({ choices: [{ message: { content: "ok" } }] }) },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.gateway.configured, true);
  assert.equal(payload.gateway.provider, "cloudflare");
  assert.equal(payload.llmRouting.primary, "cloudflare");
  assert.equal(payload.llmRouting.fallback, "local");
  assert.deepEqual(payload.llmRouting.sequence, ["cloudflare", "local"]);
  assert.equal(payload.llmRouting.primaryConfigured, true);
  assert.equal(payload.llmRouting.secondaryConfigured, true);
  assert.equal(payload.llmRouting.fallbackConfigured, true);
  assert.equal(payload.rag.d1Configured, true);
  assert.equal(payload.rag.r2Configured, true);
  assert.equal(payload.rag.embeddingConfigured, true);
  assert.equal(payload.rag.rerankConfigured, true);
  assert.equal(payload.rag.embeddingProvider, "cloudflare");
  assert.equal(payload.rag.rerankProvider, "cloudflare");
  assert.equal(payload.rag.embeddingPrimaryConfigured, true);
  assert.equal(payload.rag.embeddingFallbackConfigured, true);
  assert.deepEqual(payload.rag.routing, ["cloudflare"]);

  const degradedResponse = await request("/api/health", {
    DB: {},
    BUCKET: {},
    AI: { run: async () => ({ choices: [{ message: { content: "ok" } }] }) },
  });
  assert.equal(degradedResponse.status, 200);
  const degradedPayload = await degradedResponse.json();
  assert.equal(degradedPayload.status, "ready");
  assert.equal(degradedPayload.gateway.configured, true);
});

test("adds Cloudflare response security headers and bypasses unavailable image optimization", async () => {
  const response = await render();
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("permissions-policy") ?? "", /microphone=\(\)/);
  const portal = await readFile(new URL("app/AgentPortal.tsx", root), "utf8");
  assert.match(portal, /iljin-logo\.png[^>]+unoptimized/);
});

test("implements the Document RAG G1/G2 path with verified originals, embedding, and reranking", async () => {
  const [rag, schema, searchRoute, chatRoute, portal, ingest, results, hosting, migration, pipelineRoute, originalRoute, pipelineMigration] = await Promise.all([
    readFile(new URL("lib/rag.ts", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("app/api/v1/search/route.ts", root), "utf8"),
    readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8"),
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/components/DocumentIngest.tsx", root), "utf8"),
    readFile(new URL("app/components/RagResults.tsx", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
    readFile(new URL("drizzle/0000_chief_tempest.sql", root), "utf8"),
    readFile(new URL("app/api/admin/rag-pipeline/route.ts", root), "utf8"),
    readFile(new URL("app/api/v1/assets/[id]/original/route.ts", root), "utf8"),
    readFile(new URL("drizzle/0010_rag_pipeline_metadata.sql", root), "utf8"),
  ]);
  assert.match(schema, /sqliteTable\(\s*"assets"/);
  assert.match(schema, /sqliteTable\(\s*"segments"/);
  assert.match(schema, /sqliteTable\(\s*"index_jobs"/);
  assert.match(rag, /export function chunkDocument/);
  assert.match(rag, /export async function embedTexts/);
  assert.match(rag, /export async function embedTextsWithProvider/);
  assert.match(rag, /cloudflareEmbedTexts/);
  assert.match(rag, /cloudflareRerank/);
  assert.match(rag, /@cf\/baai\/bge-m3/);
  assert.match(rag, /@cf\/baai\/bge-reranker-base/);
  assert.match(rag, /embeddingFallbackUsed/);
  assert.match(rag, /function scoreLexical/);
  assert.match(rag, /async function rerank/);
  assert.match(rag, /EMBEDDING_BATCH_SIZE = 32/);
  assert.match(rag, /EMBEDDING_DIMENSION_MISMATCH/);
  assert.match(rag, /ASSET_SOURCE_ETAG_MISMATCH/);
  assert.match(rag, /rerankStatus/);
  assert.match(rag, /probeRagPipeline/);
  assert.match(rag, /department_scope = '\*'/);
  assert.match(rag, /denseAbsolute >= MIN_DENSE_EVIDENCE_SCORE/);
  assert.match(rag, /insufficient_evidence/);
  assert.match(rag, /fallback_no_evidence/);
  assert.match(searchRoute, /searchRag/);
  assert.match(chatRoute, /completeWithRag/);
  assert.match(portal, /<DocumentIngest/);
  assert.match(portal, /<RagResults/);
  assert.match(ingest, /\/api\/v1\/assets/);
  assert.match(results, /인용 근거/);
  assert.deepEqual(JSON.parse(hosting), {
    project_id: "appgprj_6a605822aee881919f6ed85739c76708",
    d1: "DB",
    r2: "BUCKET",
  });
  assert.match(migration, /CREATE TABLE `assets`/);
  assert.match(migration, /CREATE TABLE `segments`/);
  assert.match(pipelineRoute, /admin\.operations/);
  assert.match(pipelineRoute, /probeRagPipeline/);
  assert.match(originalRoute, /asset\.original\.download/);
  assert.match(originalRoute, /Content-Disposition/);
  assert.match(pipelineMigration, /original_etag/);
  assert.match(pipelineMigration, /embedding_dimensions/);
  assert.match(pipelineMigration, /rerank_status/);
});

test("separates internal and internet search and supports queued document drag-and-drop", async () => {
  const [portal, internetSearch, internetRoute, chatRoute, ingest, ingestCss, schema, migration, adminSearchRoute, searchOperations] = await Promise.all([
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("lib/internet-search.ts", root), "utf8"),
    readFile(new URL("app/api/v1/internet-search/route.ts", root), "utf8"),
    readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8"),
    readFile(new URL("app/components/DocumentIngest.tsx", root), "utf8"),
    readFile(new URL("app/components/DocumentIngest.css", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("drizzle/0011_internet_search_trace.sql", root), "utf8"),
    readFile(new URL("app/api/admin/internet-search/route.ts", root), "utf8"),
    readFile(new URL("app/components/InternetSearchOperations.tsx", root), "utf8"),
  ]);
  assert.match(portal, /searchScope === "internal"/);
  assert.match(portal, /\/api\/v1\/internet-search/);
  assert.match(portal, /여기에 문서를 놓으세요/);
  assert.match(portal, /onDrop=\{handleDrop\}/);
  assert.match(internetSearch, /api\.search\.brave\.com/);
  assert.match(internetSearch, /api\.tavily\.com\/search/);
  assert.match(internetSearch, /customsearch\.googleapis\.com/);
  assert.match(internetSearch, /WEBPILOT_API_URL/);
  assert.match(internetSearch, /wikipedia\.org/);
  assert.match(internetSearch, /"User-Agent": WIKIMEDIA_USER_AGENT/);
  assert.match(internetSearch, /"Api-User-Agent": WIKIMEDIA_USER_AGENT/);
  assert.match(internetSearch, /extra_snippets/);
  assert.match(internetSearch, /freshnessForQuery/);
  assert.match(internetSearch, /generator/);
  assert.match(internetSearch, /extracts\|info/);
  assert.match(internetSearch, /rerankResults/);
  assert.match(internetSearch, /buildSearchPlan/);
  assert.match(internetSearch, /providerPath/);
  assert.match(internetSearch, /INTERNET_SEARCH_PROVIDER_ORDER/);
  assert.match(internetSearch, /contextualSearchQuery/);
  assert.match(internetSearch, /INTERNET_SEARCH_UNAVAILABLE/);
  assert.match(internetSearch, /search_scope, search_provider/);
  assert.match(internetSearch, /getInternetSearchStatus/);
  assert.match(internetSearch, /probeInternetSearch/);
  assert.match(internetSearch, /sourceCategoryLabel/);
  assert.match(internetRoute, /authorizeFeature\(principal, "rag\.search", "rag\.search"\)/);
  assert.match(internetRoute, /enforceRateLimit\(principal, "internet-search", 30\)/);
  assert.match(chatRoute, /buildInternetGroundingPrompt/);
  // 근거 블록은 고정 상한을 자르는 대신 지시문·질문 길이를 뺀 나머지를 예산으로 쓴다.
  assert.match(chatRoute, /INTERNET_GROUNDING_MESSAGE_LIMIT = 7_900/);
  assert.match(chatRoute, /const sourceBudget = maxLength - instruction\.length - question\.length/);
  assert.match(chatRoute, /INTERNET_GROUNDING_SOURCE_LIMIT = 6/);
  assert.match(chatRoute, /boundedSourceContext/);
  assert.match(chatRoute, /ensureInternetCitationCoverage/);
  assert.match(chatRoute, /현재 날짜\(대한민국\)/);
  assert.match(chatRoute, /internet-grounded/);
  assert.match(chatRoute, /providerPath: webSearch\.providerPath/);
  assert.match(ingest, /document-ingest__dropzone/);
  assert.match(ingest, /onDrop=\{handleDrop\}/);
  assert.match(ingest, /multiple/);
  assert.match(ingest, /runQueue/);
  assert.match(ingest, /재시도/);
  assert.match(ingestCss, /\.document-ingest__dropzone\.is-dragging/);
  assert.match(ingestCss, /\.document-ingest__queue/);
  assert.match(schema, /searchScope/);
  assert.match(migration, /search_scope/);
  assert.match(adminSearchRoute, /requirePermission\(principal, "admin\.operations"\)/);
  assert.match(adminSearchRoute, /probeInternetSearch/);
  assert.match(searchOperations, /Brave Search/);
  assert.match(searchOperations, /Tavily Search/);
  assert.match(searchOperations, /Google Programmable Search/);
  assert.match(searchOperations, /WebPilot 호환 API/);
  assert.match(searchOperations, /Wikimedia/);
  assert.match(searchOperations, /검색 쿼리 계획/);
});

test("tracks the complete development checklist and applies new common chat and search controls", async () => {
  const [registry, checklist, checklistCss, requirementsRoute, portal, chatRoute, rag, worker, checklistDoc] = await Promise.all([
    readFile(new URL("lib/requirements-registry.ts", root), "utf8"),
    readFile(new URL("app/components/RequirementsChecklist.tsx", root), "utf8"),
    readFile(new URL("app/components/RequirementsChecklist.css", root), "utf8"),
    readFile(new URL("app/api/admin/requirements/route.ts", root), "utf8"),
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8"),
    readFile(new URL("lib/rag.ts", root), "utf8"),
    readFile(new URL("worker/index.ts", root), "utf8"),
    readFile(new URL("docs/development-requirements-checklist.md", root), "utf8"),
  ]);
  const requirementIds = [...registry.matchAll(/requirement\("(FR-[A-Z]+-\d+|NFR-[A-Z]+-\d+|DR(?:-[A-Z]+)?-\d+)"/g)].map((match) => match[1]);
  assert.ok(requirementIds.length >= 90);
  assert.equal(new Set(requirementIds).size, requirementIds.length);
  assert.match(registry, /external_required/);
  assert.match(registry, /OUTSTANDING_DEVELOPMENT_REQUIREMENTS/);
  assert.match(registry, /FR-MM-008/);
  assert.match(registry, /DR-STO-006/);
  assert.match(checklist, /개발 요구사항 체크리스트/);
  assert.match(checklist, /남은 항목/);
  assert.match(checklist, /완료 \{summary\.archivedImplemented\}개 제외/);
  assert.doesNotMatch(checklist, /<option value="implemented">완료<\/option>/);
  assert.match(checklistCss, /\.requirement-state-implemented/);
  assert.match(requirementsRoute, /requirePermission\(principal, "admin\.operations"\)/);
  assert.match(requirementsRoute, /items: OUTSTANDING_DEVELOPMENT_REQUIREMENTS/);
  assert.match(portal, /answer_length: chatAnswerLength/);
  assert.doesNotMatch(portal, /chat-answer-format/);
  assert.match(portal, /stream: true/);
  assert.match(portal, /text\/event-stream/);
  assert.match(portal, /eventName === "delta"/);
  assert.match(portal, /eventName === "citation"/);
  assert.match(portal, /eventName === "done"/);
  assert.match(portal, /createdFrom:/);
  assert.match(portal, /sourceType: sourceFilter/);
  assert.match(chatRoute, /responsePreferenceInstruction/);
  assert.match(rag, /responsePreferences/);
  assert.match(worker, /requestHeaders\.set\("X-Trace-Id", traceId\)/);
  assert.match(worker, /headers\.set\("X-Trace-Id"/);
  assert.match(checklistDoc, /전체 90개 항목/);
});

test("produces expert-depth answers with adaptive output budgets and structured rendering", async () => {
  const [portal, chatRoute, answerFormat, gateway, rag, css] = await Promise.all([
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8"),
    readFile(new URL("lib/answer-format.ts", root), "utf8"),
    readFile(new URL("lib/llm-gateway.ts", root), "utf8"),
    readFile(new URL("lib/rag.ts", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  assert.match(portal, /useState<ChatAnswerLength>\("standard"\)/);
  assert.match(portal, /표준/);
  assert.match(portal, /심층/);
  assert.match(portal, /function FormattedAnswer/);
  assert.match(portal, /answer-table-wrap/);
  assert.match(chatRoute, /function maxOutputTokensFor/);
  assert.match(chatRoute, /answerOutputTokenBudget/);
  assert.match(answerFormat, /length === "brief" \? 600 : length === "detailed" \? 2_400 : 1_800/);
  assert.match(answerFormat, /심층 의사결정 답변으로 작성하세요/);
  assert.match(gateway, /MAX_OUTPUT_TOKENS = 4_096/);
  assert.match(gateway, /max_tokens: maxOutputTokens/);
  assert.match(gateway, /분야별 수석 전문가/);
  assert.match(rag, /실무 적용 또는 권고안/);
  assert.match(css, /\.message-content h2/);
  assert.match(css, /\.answer-citation/);
  assert.match(css, /\.answer-table-wrap table/);
});

test("uses the latest available dates and document versions as the default answer basis", async () => {
  const [portal, chatRoute, gateway, rag, internetSearch] = await Promise.all([
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8"),
    readFile(new URL("lib/llm-gateway.ts", root), "utf8"),
    readFile(new URL("lib/rag.ts", root), "utf8"),
    readFile(new URL("lib/internet-search.ts", root), "utf8"),
  ]);
  assert.match(chatRoute, /function ensureReferenceDateHeader/);
  assert.match(chatRoute, /검색 및 접근 가능 문서의 최신 확인 버전 기준/);
  assert.match(chatRoute, /completion\.content = ensureReferenceDateHeader/);
  assert.match(gateway, /최신 게시·갱신일과 최신 버전을 우선/);
  assert.match(rag, /latestAssetByDocument/);
  assert.match(rag, /a\.source_type, a\.updated_at/);
  assert.match(rag, /최종 갱신 \$\{citation\.updatedAt/);
  assert.match(rag, /이전 버전은 현재 기준 사실처럼 사용하지 않습니다/);
  assert.match(internetSearch, /latestRequired: boolean/);
  assert.match(internetSearch, /isExplicitHistoricalQuery/);
  assert.match(internetSearch, /variants\.push\(`\$\{searchQuery\} \$\{currentYear\}`\)/);
  assert.match(internetSearch, /datedResults/);
  assert.match(internetSearch, /ageDays <= 30/);
  assert.match(portal, /현재 기준일과 접근 가능한 최신 문서 버전·웹 자료/);
  assert.match(portal, /updatedAt: formatSearchDate\(citation\.updatedAt/);
});

test("upgrades integrated search into an ACL-aware ILJIN Knowledge Data Base", async () => {
  const [portal, route, governance, ragResults, css] = await Promise.all([
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/api/v1/knowledge-base/route.ts", root), "utf8"),
    readFile(new URL("lib/admin-governance.ts", root), "utf8"),
    readFile(new URL("app/components/RagResults.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  assert.match(portal, /ILJIN Knowledge Data Base/);
  assert.match(portal, /\/api\/v1\/knowledge-base/);
  assert.match(portal, /최근 업데이트 지식/);
  assert.match(portal, /AI에게 질문/);
  assert.match(portal, /이 문서 검색/);
  assert.match(portal, /encodeURIComponent\(asset\.id\).*\/original/);
  assert.match(portal, /사내 지식/);
  assert.match(portal, /외부 참고자료/);
  assert.match(portal, /knowledge-operational-strip/);
  assert.match(portal, /knowledge-refresh-button/);
  assert.match(portal, /knowledgeStatusLabel/);
  assert.match(route, /authorizeFeature\(principal, "rag\.search", "rag\.search"\)/);
  assert.match(route, /listAssets\(principal, 100\)/);
  assert.match(route, /totalDocuments/);
  assert.match(route, /totalSegments/);
  assert.match(route, /recentUpdates/);
  assert.match(route, /vectorCoverage/);
  assert.match(route, /indexedDocuments/);
  assert.match(route, /failedDocuments/);
  assert.match(route, /latestUpdatedAt/);
  assert.match(governance, /label: "ILJIN Knowledge Data Base"/);
  assert.match(ragResults, /지식 검색 결과/);
  assert.match(css, /\.knowledge-hero/);
  assert.match(css, /\.knowledge-stats/);
  assert.match(css, /\.knowledge-card-grid/);
  assert.match(css, /\.knowledge-operational-strip/);
  assert.match(css, /\.knowledge-refresh-button/);
});

test("uses Cloudflare AI, Database, and Storage terminology in user-facing surfaces", async () => {
  const [portal, ingest, controlTower, operations, governance, pipeline, gateway, rag, requirements] = await Promise.all([
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/components/DocumentIngest.tsx", root), "utf8"),
    readFile(new URL("app/components/AiControlTower.tsx", root), "utf8"),
    readFile(new URL("app/components/AgentOperations.tsx", root), "utf8"),
    readFile(new URL("lib/admin-governance.ts", root), "utf8"),
    readFile(new URL("app/api/admin/rag-pipeline/route.ts", root), "utf8"),
    readFile(new URL("lib/llm-gateway.ts", root), "utf8"),
    readFile(new URL("lib/rag.ts", root), "utf8"),
    readFile(new URL("lib/requirements-registry.ts", root), "utf8"),
  ]);
  assert.match(portal, /ILJIN AI · Cloud LLM/);
  assert.match(portal, /Metadata Database/);
  assert.match(portal, /Object Storage/);
  assert.doesNotMatch(portal, /Cloudflare GLM|D1 Metadata|R2 Original|R2 원문|D1·R2/);
  assert.match(ingest, /Object Storage/);
  assert.match(ingest, /Metadata Database/);
  assert.doesNotMatch(ingest, /\bD1\b|\bR2\b|Cloudflare/);
  assert.match(controlTower, /Cloud LLM/);
  assert.match(controlTower, /Query Rewrite · Hybrid RRF · Reranker · Verifier/);
  assert.doesNotMatch(controlTower, /Cloudflare R2|D1 RUN/);
  assert.match(operations, /DATABASE RUN HISTORY/);
  assert.match(governance, /label: "Cloudflare GLM 5\.2 기본"/);
  assert.match(pipeline, /name: "Object Storage"/);
  assert.match(pipeline, /Cloudflare Embedding/);
  assert.match(gateway, /name: "Cloud LLM"/);
  assert.match(rag, /Query Rewrite \+ Dense\/BM25 \+ RRF/);
  assert.match(requirements, /Cloudflare GLM 5\.2/);
});

test("implements query planning, RRF fusion, reranking, evidence verification, and quality telemetry", async () => {
  const [rag, schema, migration, searchRoute, observability, controlTower, portal, evaluator] = await Promise.all([
    readFile(new URL("lib/rag.ts", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("drizzle/0013_rag_rrf_verifier.sql", root), "utf8"),
    readFile(new URL("app/api/v1/search/route.ts", root), "utf8"),
    readFile(new URL("app/api/admin/observability/route.ts", root), "utf8"),
    readFile(new URL("app/components/AiControlTower.tsx", root), "utf8"),
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("scripts/evaluate-rag.mjs", root), "utf8"),
  ]);
  assert.match(rag, /export function planRagQuery/);
  assert.match(rag, /export function reciprocalRankFusion/);
  assert.match(rag, /RRF_K = 40/);
  assert.match(rag, /FUSION_CANDIDATE_LIMIT = 120/);
  assert.match(rag, /RERANK_CANDIDATE_LIMIT = 50/);
  assert.match(rag, /function verifyEvidence/);
  assert.match(rag, /MIN_EVIDENCE_CONFIDENCE/);
  assert.match(rag, /queryPlan\.variants/);
  assert.match(rag, /fusionStrategy: "rrf"/);
  assert.match(rag, /verifierStatus: verifier\.status/);
  assert.match(schema, /queryVariantCount/);
  assert.match(schema, /evidenceConfidence/);
  assert.match(schema, /verifierStatus/);
  assert.match(migration, /query_variant_count/);
  assert.match(migration, /fusion_strategy/);
  assert.match(migration, /verifier_status/);
  assert.match(searchRoute, /X-Search-Strategy": "hybrid-rrf"/);
  assert.match(observability, /avg_evidence_confidence/);
  assert.match(observability, /verifier_insufficient/);
  assert.match(observability, /rrf_applied/);
  assert.match(controlTower, /RRF 융합/);
  assert.match(controlTower, /근거 부족 차단/);
  assert.match(portal, /Hybrid · RRF/);
  assert.match(portal, /근거 검증/);
  assert.match(evaluator, /context_precision_at_10/);
  assert.match(evaluator, /context_recall_at_10/);
  assert.match(evaluator, /answer_relevancy_proxy/);
  assert.match(evaluator, /faithfulness_proxy/);
  assert.match(evaluator, /evidence_verifier_pass_rate/);
});

test("implements multimodal document analysis, visual indexing, and image citations", async () => {
  const [multimodal, assetRoute, rag, portal, results, migration, runtime] = await Promise.all([
    readFile(new URL("lib/multimodal.ts", root), "utf8"),
    readFile(new URL("app/api/v1/assets/route.ts", root), "utf8"),
    readFile(new URL("lib/rag.ts", root), "utf8"),
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/components/RagResults.tsx", root), "utf8"),
    readFile(new URL("drizzle/0014_multimodal_regions.sql", root), "utf8"),
    readFile(new URL("lib/runtime-env.ts", root), "utf8"),
  ]);
  assert.match(multimodal, /AI\.toMarkdown/);
  assert.match(multimodal, /application\/pdf/);
  assert.match(multimodal, /image\/png/);
  assert.match(assetRoute, /analyzeMultimodalFile/);
  // The upload is read once and reused for analysis and R2 storage.
  assert.match(assetRoute, /const originalData = await file\.arrayBuffer\(\)/);
  assert.match(assetRoute, /analyzeMultimodalFile\(file, originalData\)/);
  assert.match(assetRoute, /originalData,/);
  assert.match(rag, /CREATE TABLE IF NOT EXISTS visual_regions/);
  assert.match(rag, /group_concat\(DISTINCT vr\.region_type\)/);
  assert.match(rag, /originalUrl/);
  assert.match(rag, /queryModality/);
  assert.match(rag, /modalityBoost/);
  assert.match(multimodal, /extractVisualRegions/);
  assert.match(multimodal, /regionType: "table"/);
  assert.match(multimodal, /regionType: "chart"/);
  assert.match(assetRoute, /regionCount/);
  assert.match(portal, /멀티모달 첨부/);
  assert.match(portal, /이미지 근거/);
  assert.match(results, /rag-document__visual/);
  assert.match(migration, /visual_regions/);
  assert.match(runtime, /CLOUD_VLM_MODEL/);
});

test("stores and queries current embeddings through tenant-filtered Cloudflare Vectorize", async () => {
  const [rag, runtime, pagesConfig, indexerConfig, pipeline, controlTower, migration] = await Promise.all([
    readFile(new URL("lib/rag.ts", root), "utf8"),
    readFile(new URL("lib/runtime-env.ts", root), "utf8"),
    readFile(new URL("wrangler.jsonc", root), "utf8"),
    readFile(new URL("indexer/wrangler.jsonc", root), "utf8"),
    readFile(new URL("app/api/admin/rag-pipeline/route.ts", root), "utf8"),
    readFile(new URL("app/components/AiControlTower.tsx", root), "utf8"),
    readFile(new URL("drizzle/0019_vectorize_index.sql", root), "utf8"),
  ]);
  assert.match(runtime, /VECTOR_INDEX\?: VectorizeIndex/);
  assert.match(pagesConfig, /"binding": "VECTOR_INDEX"/);
  assert.match(indexerConfig, /"binding": "VECTOR_INDEX"/);
  assert.match(rag, /index\.upsert/);
  assert.match(rag, /index\.query/);
  assert.match(rag, /index\.deleteByIds/);
  assert.match(rag, /tenant_id: \{ \$eq: tenantId \}/);
  assert.match(rag, /repairVectorIndexBatch/);
  assert.match(pipeline, /name: "Vector DB"/);
  assert.match(controlTower, /임베딩·Vector DB 복구/);
  assert.match(migration, /vector_indexed_at/);
});

test("scopes temporary chat attachments to their conversation and deletes them at conversation end", async () => {
  const [portal, assetRoute, chatRoute, attachmentRoute, conversationRoute, conversations, cleanup, rag, schema, migration, ingest] = await Promise.all([
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/api/v1/assets/route.ts", root), "utf8"),
    readFile(new URL("app/api/v1/chat/completions/route.ts", root), "utf8"),
    readFile(new URL("app/api/v1/conversations/[id]/attachments/route.ts", root), "utf8"),
    readFile(new URL("app/api/v1/conversations/[id]/route.ts", root), "utf8"),
    readFile(new URL("lib/conversations.ts", root), "utf8"),
    readFile(new URL("lib/conversation-attachments.ts", root), "utf8"),
    readFile(new URL("lib/rag.ts", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("drizzle/0018_conversation_attachments.sql", root), "utf8"),
    readFile(new URL("app/components/DocumentIngest.tsx", root), "utf8"),
  ]);

  assert.match(portal, /form\.set\("retention", "temporary"\)/);
  assert.match(portal, /form\.set\("conversation_id", activeConversationId\)/);
  assert.match(portal, /대화 임시 첨부/);
  assert.match(portal, /새 대화를 시작하거나 대화를 삭제하면 원본과 인덱스가 함께 삭제/);
  assert.match(assetRoute, /attachConversationAsset/);
  assert.match(assetRoute, /deduplicate: !temporaryConversationId/);
  assert.match(chatRoute, /getConversationAttachmentAssetIds/);
  assert.match(chatRoute, /assetIds: attachmentAssetIds\.length/);
  assert.match(attachmentRoute, /cleanupConversationAttachments/);
  assert.match(conversationRoute, /cleanupConversationAttachments/);
  assert.match(conversations, /CREATE TABLE IF NOT EXISTS conversation_attachments/);
  assert.match(cleanup, /await deleteAsset/);
  assert.match(rag, /AND a\.id IN/);
  assert.match(rag, /assetIds: input\.assetIds/);
  assert.match(schema, /conversationAttachments/);
  assert.match(migration, /conversation_attachments/);
  assert.match(ingest, /지식베이스 영구 등록/);
});

test("conversation creation response wraps the id so attachment upload can read it", async () => {
  // 회귀 대상: createConversation() 은 문자열 id 만 반환하는데 라우트가 그걸
  // 그대로 JSON 본문으로 내보내면, 클라이언트는 payload.conversation_id 를
  // 읽으므로 항상 undefined 가 되어 "첨부파일용 대화를 만들지 못했습니다"가
  // 성공한 요청에서도 뜬다.
  const [route, conversations, portal] = await Promise.all([
    readFile(new URL("app/api/v1/conversations/route.ts", root), "utf8"),
    readFile(new URL("lib/conversations.ts", root), "utf8"),
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
  ]);
  assert.match(conversations, /return conversationId;/);
  assert.match(route, /ok\(\{ conversation_id: conversationId \}/);
  assert.match(portal, /payload\.conversation_id/);
});

test("self-heals legacy conversation schema before follow-up questions load context", async () => {
  const conversations = await readFile(new URL("lib/conversations.ts", root), "utf8");
  assert.match(conversations, /PRAGMA table_info\(conversations\)/);
  assert.match(conversations, /ALTER TABLE conversations ADD COLUMN summary_json TEXT/);
  assert.match(conversations, /ALTER TABLE conversations ADD COLUMN summary_message_count INTEGER DEFAULT 0/);
});

test("readiness reports degraded failover without presenting the primary provider as unavailable", async () => {
  const route = await readFile(new URL("app/api/admin/readiness/route.ts", root), "utf8");
  assert.match(route, /readiness\.status === "configuration_required" \? 503 : 200/);
});

test("suggests frequent questions and recent authorized work issues at the top of chat", async () => {
  const [activity, portal, css] = await Promise.all([
    readFile(new URL("lib/activity.ts", root), "utf8"),
    readFile(new URL("app/AgentPortal.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  assert.match(activity, /HAVING COUNT\(\*\) >= 2/);
  assert.match(activity, /c\.owner_email = \?/);
  assert.match(activity, /conversation_attachments ca/);
  assert.match(activity, /suggestedQuestions: suggestions\.slice\(0, 6\)/);
  assert.match(portal, /지금 확인하면 좋은 업무 질문/);
  assert.match(portal, /자주 찾음/);
  assert.match(portal, /최근 이슈/);
  assert.match(css, /\.chat-smart-suggestions/);
});

test("caps Cloudflare AI spend below $50 and reserves GLM 5.2 for deep reasoning", async () => {
  const [guard, gateway, cloudflareAi, budgetRoute, consoleUi, config] = await Promise.all([
    readFile(new URL("lib/cloud-cost-guard.ts", root), "utf8"),
    readFile(new URL("lib/llm-gateway.ts", root), "utf8"),
    readFile(new URL("lib/cloudflare-ai.ts", root), "utf8"),
    readFile(new URL("app/api/admin/budget/route.ts", root), "utf8"),
    readFile(new URL("app/components/OrgConsole.tsx", root), "utf8"),
    readFile(new URL("wrangler.jsonc", root), "utf8"),
  ]);
  assert.match(guard, /CLOUD_COST_CAP_USD = 45/);
  assert.match(guard, /spent_microusd \+ reserved_microusd \+ \? <= \?/);
  assert.match(gateway, /CLOUD_COST_CAP_REACHED/);
  assert.match(gateway, /reserveCloudflareLlmSpend/);
  assert.match(cloudflareAi, /assertCloudCostAvailable/);
  assert.match(budgetRoute, /getCloudCostStatus/);
  assert.match(consoleUi, /Cloudflare AI monthly cost/);
  assert.match(gateway, /CLOUDFLARE_AI_PREMIUM_MODEL/);
  assert.match(gateway, /reasoningTier === "deep"/);
  assert.match(config, /@cf\/zai-org\/glm-4\.7-flash/);
});

test("connects file links, personal PC folders, and local databases to scheduled embedding ingestion", async () => {
  const [sources, document, rag, worker, connectorRoute] = await Promise.all([
    readFile(new URL("app/components/IngestionSources.tsx", root), "utf8"),
    readFile(new URL("app/components/DocumentIngest.tsx", root), "utf8"),
    readFile(new URL("lib/rag.ts", root), "utf8"),
    readFile(new URL("indexer/worker.ts", root), "utf8"),
    readFile(new URL("app/api/v1/assets/connectors/route.ts", root), "utf8"),
  ]);
  assert.match(sources, /"file-link": "파일 링크"/);
  assert.match(sources, /"network-folder": "네트워크 폴더"/);
  assert.match(sources, /"pc-folder": "PC 폴더"/);
  assert.match(sources, /자동 임베딩 연결/);
  assert.match(rag, /source_type: .*"local-db"/);
  assert.match(rag, /documents: \[\]/);
  assert.match(document, /개인 PC 폴더/);
  assert.match(document, /로컬 DB 자동 임베딩 연결/);
  assert.match(document, /webkitdirectory/);
  assert.match(rag, /safeRemoteUrl/);
  assert.match(rag, /BLOCKED_SOURCE_HOST/);
  assert.match(rag, /MAX_INGESTION_FILE_BYTES/);
  assert.match(rag, /source\.source_type === "network-folder"/);
  assert.match(rag, /source\.source_type === "local-db"/);
  assert.match(rag, /runIngestionSource/);
  assert.match(worker, /getDueIngestionSources/);
  assert.match(connectorRoute, /documents\.manage/);
  assert.match(connectorRoute, /local-db/);
});

test("shows live queued embedding progress for registered documents", async () => {
  const [document, assetRoute, assetDetail, rag, worker] = await Promise.all([
    readFile(new URL("app/components/DocumentIngest.tsx", root), "utf8"),
    readFile(new URL("app/api/v1/assets/route.ts", root), "utf8"),
    readFile(new URL("app/api/v1/assets/[id]/route.ts", root), "utf8"),
    readFile(new URL("lib/rag.ts", root), "utf8"),
    readFile(new URL("indexer/worker.ts", root), "utf8"),
  ]);
  assert.match(document, /embedding-progress/);
  assert.match(document, /processedChunks/);
  assert.match(document, /\/api\/v1\/assets\/\$\{assetId\}/);
  assert.match(assetRoute, /beginQueuedIngest/);
  assert.match(assetRoute, /INDEX_QUEUE/);
  assert.match(assetDetail, /getAsset/);
  assert.match(rag, /processed_chunks/);
  assert.match(rag, /index_stage/);
  assert.match(worker, /isTextDocument/);
});
