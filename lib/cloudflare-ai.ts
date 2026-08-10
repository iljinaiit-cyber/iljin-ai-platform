import { getRuntimeEnv, type RuntimeEnv } from "./runtime-env";
import { assertCloudCostAvailable } from "./cloud-cost-guard";

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

/** Gateway 캐시 TTL. 임베딩은 모델이 바뀌지 않는 한 결과가 고정이다. */
const AI_GATEWAY_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * 결정적 출력이라 캐시해도 되는 모델인지 판단한다.
 *
 * 임베딩·재순위는 같은 입력 → 같은 출력이므로 캐시가 안전하고 효과도 크다
 * (재색인·반복 질의에서 그대로 절감된다).
 * 생성 모델은 캐시하지 않는다. 같은 질문이라도 대화 맥락과 검색 근거가
 * 다르면 답이 달라야 하는데, 캐시가 그것을 덮어버린다.
 */
function isCacheableModelKind(model: string): boolean {
  return /embed|rerank/i.test(model);
}

export async function runCloudflareWorkersAiModel<T>(
  model: string,
  input: Record<string, unknown>,
  runtime: RuntimeEnv = getRuntimeEnv(),
  timeoutMs = 60_000,
): Promise<T> {
  await assertCloudCostAvailable();
  if (hasCloudflareAiBinding(runtime)) {
    // AI Gateway 를 경유시키면 세 가지를 얻는다.
    //   1) 관측 — 모델별 호출·토큰·비용이 Gateway 대시보드에 분해되어 남는다.
    //      2026-08-02 청구에서 "어느 모델이 얼마를 썼는지" 알 수 없었던 문제를 푼다.
    //   2) 캐시 — 동일 입력은 모델을 거치지 않아 뉴런을 쓰지 않는다.
    //   3) 레이트리밋·폴백을 Gateway 설정으로 걸 수 있다.
    // gateway id 가 없으면 옵션 없이 호출한다 — 구성 전에도 동작해야 한다.
    const gatewayId = runtime.CLOUDFLARE_AI_GATEWAY_ID;
    if (!gatewayId) return runtime.AI!.run(model, input) as Promise<T>;

    return runtime.AI!.run(model, input, {
      gateway: {
        id: gatewayId,
        // 임베딩·재순위는 같은 입력이면 같은 출력이라 캐시가 안전하다.
        // 생성(chat)은 캐시하지 않는다 — 같은 질문에 항상 같은 답을 주면
        // 대화 맥락이 무시되고, 근거가 바뀌어도 옛 답이 나간다.
        ...(isCacheableModelKind(model) ? { cacheTtl: AI_GATEWAY_CACHE_TTL_SECONDS } : { skipCache: true }),
      },
    }) as Promise<T>;
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
