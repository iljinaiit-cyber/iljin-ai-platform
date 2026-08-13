import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("production identity headers require explicit trusted mode and host allowlist", async () => {
  const identity = await source("lib/identity.ts");
  assert.match(identity, /TRUSTED_IDENTITY_MODE !== "sites-siwc"/);
  assert.match(identity, /TRUSTED_IDENTITY_HOSTS/);
  assert.match(identity, /trustedForwardedIdentityAllowed\(request\)/);
});

test("edge rate limits protect API and auth paths before the application handler", async () => {
  const worker = await source("worker/index.ts");
  const guardrails = await source("lib/guardrails.ts");
  assert.match(worker, /enforceEdgeRateLimit\(tracedRequest, rateLimitKind\)/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/auth\/"\)/);
  assert.match(guardrails, /EDGE_RATE_LIMITER/);
  assert.match(guardrails, /AUTH_RATE_LIMITER/);
  assert.match(guardrails, /DELETE FROM rate_limit_buckets WHERE expires_at <=/);
});

test("internal search has a principal-level rate limit", async () => {
  const search = await source("app/api/v1/search/route.ts");
  assert.match(search, /enforceRateLimit\(principal, "search", 60\)/);
});

test("production indexer has no public workers.dev route", async () => {
  const config = await source("indexer/wrangler.jsonc");
  assert.match(config, /"workers_dev": false/);
  assert.match(config, /"preview_urls": false/);
});
