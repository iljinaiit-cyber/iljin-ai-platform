import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import { sites } from "./build/sites-vite-plugin";

// D1/R2/AI bindings and compatibility settings come from wrangler.jsonc.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

// Runtime settings that .env.local may supply for local development. Anything not
// listed here is ignored, so a stray local variable can never reach the Worker.
const LOCAL_DEV_VARS = [
  "LOCAL_LLM_BASE_URL",
  "LOCAL_LLM_MODEL",
  "LOCAL_LLM_API_KEY",
  "LOCAL_LLM_ACCESS_CLIENT_ID",
  "LOCAL_LLM_ACCESS_CLIENT_SECRET",
  "LOCAL_LLM_TIMEOUT_MS",
  "LOCAL_EMBED_MODEL",
  "CLOUDFLARE_AI_MODEL",
  "CLOUDFLARE_EMBED_MODEL",
  "CLOUDFLARE_RERANK_MODEL",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_AI_GATEWAY_ID",
  "CLOUD_VLM_MODEL",
  "TAVILY_API_KEY",
  "GOOGLE_SEARCH_API_KEY",
  "GOOGLE_SEARCH_ENGINE_ID",
  "BRAVE_SEARCH_API_KEY",
  "WEBPILOT_API_URL",
  "WEBPILOT_API_KEY",
  "JINA_API_KEY",
  "INTERNET_SEARCH_PROVIDER_ORDER",
  "LLM_TIMEOUT_MS",
  "DEFAULT_TENANT_ID",
  "DEFAULT_DEPARTMENT",
  "DEFAULT_USER_ROLE",
  "ALLOW_DEV_IDENTITY",
  "ADMIN_EMAILS",
  "ADMIN_BOOTSTRAP_TOKEN",
] as const;

// .env.local is a local-development file. Its values must never be baked into a
// deployed bundle: `LOCAL_LLM_BASE_URL` would pin production at 127.0.0.1 and an
// empty `ADMIN_EMAILS` would clobber the wrangler.jsonc value. Deployed runtime
// settings come from wrangler.jsonc vars and Cloudflare secrets instead.
function createLocalBindingConfig(env: Record<string, string>, isDevelopment: boolean) {
  if (!isDevelopment) return { main: "./worker/index.ts" };
  const vars: Record<string, string> = {};
  for (const key of LOCAL_DEV_VARS) {
    const value = env[key];
    // Empty values are treated as "not configured" so wrangler.jsonc keeps its value.
    if (typeof value === "string" && value !== "") vars[key] = value;
  }
  return { main: "./worker/index.ts", vars };
}

export default defineConfig(async ({ mode, command }) => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const { cloudflare } = await import("@cloudflare/vite-plugin");
  const localBindingConfig = createLocalBindingConfig(loadEnv(mode, process.cwd(), ""), command === "serve");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
