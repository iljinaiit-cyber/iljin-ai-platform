import { getRuntimeEnv, type RuntimeEnv } from "./runtime-env";

export function hasCloudflareAiBinding(runtime: RuntimeEnv = getRuntimeEnv()) {
  return Boolean(runtime.AI && typeof runtime.AI.run === "function");
}

export function hasCloudflareAiRestCredentials(runtime: RuntimeEnv = getRuntimeEnv()) {
  return Boolean(runtime.CLOUDFLARE_ACCOUNT_ID && runtime.CLOUDFLARE_API_TOKEN);
}

export function isCloudflareAiConfigured(runtime: RuntimeEnv = getRuntimeEnv()) {
  return hasCloudflareAiBinding(runtime) || hasCloudflareAiRestCredentials(runtime);
}

export function cloudflareAiRestBaseUrl(runtime: RuntimeEnv = getRuntimeEnv()) {
  if (!hasCloudflareAiRestCredentials(runtime)) return undefined;
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(runtime.CLOUDFLARE_ACCOUNT_ID!)}/ai`;
}

export function cloudflareAiHeaders(runtime: RuntimeEnv = getRuntimeEnv()) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${runtime.CLOUDFLARE_API_TOKEN}`,
  };
  if (runtime.CLOUDFLARE_AI_GATEWAY_ID) {
    headers["cf-aig-gateway-id"] = runtime.CLOUDFLARE_AI_GATEWAY_ID;
  }
  return headers;
}

function modelPath(model: string) {
  return model.split("/").map((part) => encodeURIComponent(part)).join("/");
}

export async function runCloudflareWorkersAiModel<T>(
  model: string,
  input: Record<string, unknown>,
  runtime: RuntimeEnv = getRuntimeEnv(),
  timeoutMs = 60_000,
): Promise<T> {
  if (hasCloudflareAiBinding(runtime)) {
    return runtime.AI!.run(model, input) as Promise<T>;
  }

  const baseUrl = cloudflareAiRestBaseUrl(runtime);
  if (!baseUrl) throw new Error("Cloudflare AI binding 또는 REST 인증이 설정되지 않았습니다.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/run/${modelPath(model)}`, {
      method: "POST",
      headers: {
        ...cloudflareAiHeaders(runtime),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const payload = await response.json() as {
      success?: boolean;
      result?: T;
      errors?: Array<{ message?: string }>;
    };
    if (!response.ok || payload.success === false) {
      const detail = payload.errors?.map((error) => error.message).filter(Boolean).join("; ");
      throw new Error(detail || `Cloudflare AI REST API가 HTTP ${response.status}로 응답했습니다.`);
    }
    return (payload.result ?? payload) as T;
  } finally {
    clearTimeout(timeout);
  }
}
