"use client";

import { useCallback, useEffect, useState } from "react";
import "./PlatformOperationsConsole.css";

type Health = {
  status?: string;
  bindings?: Record<string, boolean>;
  gateway?: { model?: string; configured?: boolean };
};

type ProviderProbe = {
  provider?: string;
  status?: string;
  latencyMs?: number;
  latency_ms?: number;
  detail?: string;
  checkedAt?: string;
  checked_at?: string;
};

type Pipeline = {
  components?: Array<{ id: string; name: string }>;
};

type ProbeResult = { status?: string; detail?: string; latencyMs?: number; checkedAt?: string };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || "요청을 처리하지 못했습니다.");
  return payload;
}

/** API 가 이미 내려주지만 화면에 표시되지 않던 마지막 점검 시각을 사람이 읽는 형태로 바꾼다. */
function formatCheckedAt(value?: string) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return undefined;
  return `${new Date(timestamp).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} 점검`;
}

export function PlatformOperationsConsole() {
  const [health, setHealth] = useState<Health>();
  const [providers, setProviders] = useState<ProviderProbe[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline>({});
  const [pipelineProbes, setPipelineProbes] = useState<Record<string, ProbeResult>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [healthData, providerData, pipelineData] = await Promise.all([
        json<Health>("/api/health", { signal }),
        json<{ probes?: ProviderProbe[] }>("/api/admin/providers", { signal }),
        json<Pipeline>("/api/admin/rag-pipeline", { signal }),
      ]);
      setHealth(healthData);
      setProviders(providerData.probes ?? []);
      setPipeline(pipelineData);
      setError("");
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "운영 상태를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const runProvider = async (provider: string, action: "probe" | "reset_circuit") => {
    setBusy(`${action}:${provider}`); setMessage(""); setError("");
    try {
      await json("/api/admin/providers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, provider }),
      });
      await load();
      setMessage(action === "probe" ? `${provider} 연결을 점검했습니다.` : `${provider} 회로 상태를 초기화했습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "작업을 처리하지 못했습니다.");
    } finally {
      setBusy("");
    }
  };

  const probeOnePipelineComponent = async (component: { id: string; name: string }) => {
    const payload = await json<{ probe?: ProbeResult }>(`/api/admin/rag-pipeline?component=${encodeURIComponent(component.id)}`);
    if (payload.probe) setPipelineProbes((items) => ({ ...items, [component.id]: payload.probe! }));
  };

  const runPipelineProbe = async (component: { id: string; name: string }) => {
    setBusy(`pipeline:${component.id}`); setMessage(""); setError("");
    try {
      await probeOnePipelineComponent(component);
      setMessage(`${component.name} 연결을 점검했습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "연결을 점검하지 못했습니다.");
    } finally {
      setBusy("");
    }
  };

  // LLM 공급자는 Control Tower 의 "전체 연결 테스트"가 이미 일괄 점검을 제공한다
  // (/api/admin/providers probe_all). RAG 파이프라인은 그 범위 밖이라 동일한
  // 일괄 점검이 어디에도 없었다 — 구성요소 수만큼 하나씩 눌러야 했다.
  const runAllPipelineProbes = async () => {
    const components = pipeline.components ?? [];
    if (!components.length) return;
    setBusy("pipeline:all"); setMessage(""); setError("");
    const results = await Promise.allSettled(components.map(probeOnePipelineComponent));
    const failed = results.filter((result) => result.status === "rejected").length;
    setMessage(failed ? `${components.length - failed}/${components.length}개 점검 완료 (${failed}개 실패)` : `${components.length}개 구성요소 점검을 완료했습니다.`);
    if (failed === components.length) setError("파이프라인 전체 점검에 실패했습니다.");
    setBusy("");
  };

  const bindings = Object.entries(health?.bindings ?? {});

  return (
    <section className="platform-console" id="admin-platform" aria-labelledby="platform-console-title">
      <header className="platform-console__header">
        <div><span>PLATFORM OPERATIONS</span><h2 id="platform-console-title">플랫폼 운영 제어</h2></div>
        <div className="platform-console__actions">
          <strong data-state={health?.status || "checking"}>{loading ? "확인 중" : health?.status || "확인 필요"}</strong>
          <button type="button" onClick={() => void load()} disabled={loading || Boolean(busy)}>상태 새로고침</button>
        </div>
      </header>

      {error ? <p className="platform-console__message platform-console__message--error" role="alert">{error}</p> : null}
      {message ? <p className="platform-console__message" role="status">{message}</p> : null}

      <div className="platform-console__bindings" aria-label="Cloudflare 바인딩 상태">
        {bindings.map(([name, connected]) => <div key={name} data-connected={connected}><span>{name.replace(/_/g, " ")}</span><strong>{connected ? "연결" : "미설정"}</strong></div>)}
        {!bindings.length && <p>바인딩 상태를 확인 중입니다.</p>}
      </div>

      <div className="platform-console__grid">
        <section>
          <div className="platform-console__section-head"><h3>LLM 공급자</h3><span>{health?.gateway?.model || "모델 미확인"}</span></div>
          <ul className="platform-console__list">
            {providers.map((probe) => {
              const provider = probe.provider || "unknown";
              const probeBusy = busy === `probe:${provider}`;
              const resetBusy = busy === `reset_circuit:${provider}`;
              const latency = probe.latencyMs ?? probe.latency_ms;
              const checkedAt = formatCheckedAt(probe.checkedAt ?? probe.checked_at);
              return <li key={provider}>
                <div><strong>{provider}</strong><span data-state={probe.status || "unknown"}>{probe.status || "미점검"}</span><small>{probe.detail || "최근 진단 기록이 없습니다."}{latency !== undefined ? ` · ${latency}ms` : ""}{checkedAt ? ` · ${checkedAt}` : ""}</small></div>
                <div className="platform-console__row-actions">
                  <button type="button" onClick={() => void runProvider(provider, "probe")} disabled={Boolean(busy)}>{probeBusy ? "점검 중" : "점검"}</button>
                  <button type="button" onClick={() => void runProvider(provider, "reset_circuit")} disabled={Boolean(busy)}>{resetBusy ? "초기화 중" : "회로 초기화"}</button>
                </div>
              </li>;
            })}
            {!providers.length && <li><small>공급자 진단 기록이 없습니다. 제어 타워에서 전체 연결 점검을 실행할 수 있습니다.</small></li>}
          </ul>
        </section>

        <section>
          <div className="platform-console__section-head">
            <h3>RAG 파이프라인</h3>
            <div className="platform-console__section-actions">
              <span>원격 진단</span>
              <button type="button" onClick={() => void runAllPipelineProbes()} disabled={Boolean(busy) || !(pipeline.components ?? []).length}>{busy === "pipeline:all" ? "전체 점검 중" : "전체 점검"}</button>
            </div>
          </div>
          <ul className="platform-console__list">
            {(pipeline.components ?? []).map((component) => {
              const result = pipelineProbes[component.id];
              const checkedAt = formatCheckedAt(result?.checkedAt);
              return <li key={component.id}>
                <div><strong>{component.name}</strong><span data-state={result?.status || "unknown"}>{result?.status || "미점검"}</span><small>{result?.detail || "연결 진단을 실행하면 결과가 표시됩니다."}{result?.latencyMs !== undefined ? ` · ${result.latencyMs}ms` : ""}{checkedAt ? ` · ${checkedAt}` : ""}</small></div>
                <button type="button" onClick={() => void runPipelineProbe(component)} disabled={Boolean(busy)}>{busy === `pipeline:${component.id}` ? "점검 중" : "점검"}</button>
              </li>;
            })}
          </ul>
        </section>
      </div>
    </section>
  );
}
