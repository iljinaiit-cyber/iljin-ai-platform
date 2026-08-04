/** Cloudflare Worker entry point for the vinext application. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { setRuntimeEnv, type RuntimeEnv } from "../lib/runtime-env";

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

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    setRuntimeEnv(env);
    const url = new URL(request.url);
    const traceId = request.headers.get("X-Trace-Id")
      || `TRC-${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("X-Trace-Id", traceId);
    const tracedRequest = new Request(request, { headers: requestHeaders });

    if (url.pathname === "/_vinext/image") {
      if (!env.IMAGES) {
        return withResponsePolicy(Response.json({ error: "image_optimization_not_configured" }, { status: 503 }), url, traceId);
      }
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(tracedRequest, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, tracedRequest.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES!.input(body)
            .transform(width > 0 ? { width } : {})
            .output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return withResponsePolicy(response, url, traceId);
    }

    return withResponsePolicy(await handler.fetch(tracedRequest, env, ctx), url, traceId);
  },
};

export default worker;
