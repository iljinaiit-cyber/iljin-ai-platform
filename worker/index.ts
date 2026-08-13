/** Cloudflare Worker entry point for the vinext application. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { setRuntimeEnv, type RuntimeEnv } from "../lib/runtime-env";
import { enforceEdgeRateLimit, guardrailResponse } from "../lib/guardrails";
import { fail } from "../app/api/_shared";

interface Env extends RuntimeEnv {
  ASSETS: Fetcher;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https:",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
].join("; ");

function withResponsePolicy(response: Response, url: URL, traceId: string) {
  const headers = new Headers(response.headers);
  headers.set("X-Trace-Id", headers.get("X-Trace-Id") || traceId);
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  if (url.protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (/^\/assets\//.test(url.pathname) || /\.[a-f0-9]{8,}\.(?:js|css|woff2?)$/i.test(url.pathname)) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function edgeRateLimitKind(url: URL) {
  if (!url.pathname.startsWith("/api/") || url.pathname === "/api/health") return undefined;
  return url.pathname.startsWith("/api/auth/") ? "auth" as const : "api" as const;
}

function logRequest(request: Request, url: URL, traceId: string, status: number) {
  if (!url.pathname.startsWith("/api/")) return;
  console.log(JSON.stringify({
    event: "request_complete",
    trace_id: traceId,
    method: request.method,
    host: url.hostname,
    path: url.pathname,
    status,
    ip: request.headers.get("cf-connecting-ip") || "unknown",
    country: request.headers.get("cf-ipcountry") || "unknown",
    ray: request.headers.get("cf-ray") || "unknown",
    user_agent: (request.headers.get("user-agent") || "").slice(0, 240),
  }));
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    setRuntimeEnv(env);
    const url = new URL(request.url);
    const requestedTraceId = request.headers.get("X-Trace-Id")?.trim();
    const traceId = requestedTraceId && /^[A-Za-z0-9_-]{1,100}$/.test(requestedTraceId)
      ? requestedTraceId
      : `TRC-${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("X-Trace-Id", traceId);
    const tracedRequest = new Request(request, { headers: requestHeaders });

    try {
      const rateLimitKind = edgeRateLimitKind(url);
      if (rateLimitKind) await enforceEdgeRateLimit(tracedRequest, rateLimitKind);

      let response: Response;
      if (url.pathname === "/_vinext/image") {
        if (!env.IMAGES) {
          response = Response.json({ error: "image_optimization_not_configured" }, { status: 503 });
        } else {
          const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
          response = await handleImageOptimization(tracedRequest, {
            fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, tracedRequest.url))),
            transformImage: async (body, { width, format, quality }) => {
              const result = await env.IMAGES!.input(body)
                .transform(width > 0 ? { width } : {})
                .output({ format, quality });
              return result.response();
            },
          }, allowedWidths);
        }
      } else {
        response = await handler.fetch(tracedRequest, env, ctx);
      }
      logRequest(tracedRequest, url, traceId, response.status);
      return withResponsePolicy(response, url, traceId);
    } catch (error) {
      const limited = guardrailResponse(error, traceId);
      const response = limited || fail(error, traceId);
      logRequest(tracedRequest, url, traceId, response.status);
      return withResponsePolicy(response, url, traceId);
    }
  },
};

export default worker;
