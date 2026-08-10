"use client";

import { useEffect, useState } from "react";
import "./InternetSearchOperations.css";

type SearchProvider = "tavily" | "exa" | "google" | "brave" | "webpilot" | "duckduckgo" | "jina" | "wikimedia";

type ProviderStatus = {
  id: SearchProvider;
  name: string;
  order: number;
  configured: boolean;
  capability: string;
  configuration: string;
};

type SearchStatus = {
  configured: boolean;
  preferredProvider: SearchProvider;
  fallbackProvider: "wikimedia";
  activeProvider: SearchProvider;
  status: "ready" | "fallback";
  detail: string;
  providers: ProviderStatus[];
};

type SearchAttempt = {
  provider: SearchProvider;
  status: "success" | "empty" | "failed" | "skipped";
  resultCount: number;
  latencyMs: number;
  detail: string;
};

type SearchProbe = {
  status: "ready" | "degraded" | "failed";
  provider: SearchProvider;
  latencyMs: number;
  resultCount: number;
  fallbackUsed: boolean;
  providerPath: SearchAttempt[];
  detail: string;
  checkedAt: string;
};

const providerName = (provider: SearchProvider) => ({
  tavily: "Tavily Search",
  exa: "Exa Search",
  google: "Google Programmable Search",
  brave: "Brave Search",
  webpilot: "WebPilot 호환 API",
  duckduckgo: "DuckDuckGo Web Search",
  jina: "Jina AI Search",
  wikimedia: "Wikimedia",
})[provider];

export function InternetSearchOperations() {
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [probe, setProbe] = useState<SearchProbe | null>(null);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/internet-search", { cache: "no-store" });
      const payload = await response.json() as SearchStatus & { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "인터넷 검색 설정을 확인하지 못했습니다.");
      setStatus(payload);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "인터넷 검색 설정을 확인하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetch("/api/admin/internet-search", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as SearchStatus & { error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message || "인터넷 검색 설정을 확인하지 못했습니다.");
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        setStatus(payload);
        setError("");
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "인터넷 검색 설정을 확인하지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const runProbe = async () => {
    setProbing(true);
    setError("");
    try {
      const response = await fetch("/api/admin/internet-search", { method: "POST" });
      const payload = await response.json() as { probe?: SearchProbe; error?: { message?: string } };
      if (!response.ok && !payload.probe) throw new Error(payload.error?.message || "연결 진단에 실패했습니다.");
      if (payload.probe) setProbe(payload.probe);
      await load();
    } catch (probeError) {
      setError(probeError instanceof Error ? probeError.message : "연결 진단에 실패했습니다.");
    } finally {
      setProbing(false);
    }
  };

  const state = probe?.status || status?.status || "unknown";
  const activeName = status ? providerName(status.activeProvider) : "검색 공급자";

  return (
    <article className="operations-card internet-search-operations">
      <div className="operations-title">
        <div><span>INTERNET SEARCH AGENT</span><h3>공개 웹 검색 공급자</h3></div>
        <strong className={`ops-state ops-${state}`}>{loading ? "확인 중" : state}</strong>
      </div>
      {error && <p className="internet-search-operations__error" role="alert">{error}</p>}
      <div className="internet-search-operations__flow" aria-label="인터넷 검색 에이전트 실행 흐름">
        <span>질문 분석</span><b>→</b><span>검색 쿼리 계획</span><b>→</b><span>다중 공급자 검색</span><b>→</b><span>재정렬·출처 검증</span><b>→</b><span>LLM 답변</span>
      </div>
      <div className="internet-search-operations__route" aria-label="인터넷 검색 공급자 순서">
        {(status?.providers || []).map((provider, index) => (
          <div className="internet-search-operations__route-item" key={provider.id}>
            <article data-active={status?.activeProvider === provider.id} data-configured={provider.configured}>
              <span>{provider.id === "wikimedia" ? "FALLBACK" : `PRIORITY ${provider.order}`}</span>
              <strong>{provider.name}</strong>
              <small>{provider.configured ? "사용 가능" : `${provider.configuration} 필요`}</small>
              <p>{provider.capability}</p>
            </article>
            {index < (status?.providers.length || 0) - 1 && <b aria-hidden="true">→</b>}
          </div>
        ))}
      </div>
      <p className="internet-search-operations__detail">{status?.detail || "검색 공급자 상태를 불러오고 있습니다."}</p>
      {probe && (
        <>
          <dl className="internet-search-operations__probe">
            <div><dt>실사용 공급자</dt><dd>{providerName(probe.provider)}</dd></div>
            <div><dt>응답 시간</dt><dd>{probe.latencyMs}ms</dd></div>
            <div><dt>결과 수</dt><dd>{probe.resultCount}건</dd></div>
            <div><dt>진단 결과</dt><dd>{probe.detail}</dd></div>
          </dl>
          <ol className="internet-search-operations__attempts">
            {probe.providerPath.map((attempt) => (
              <li key={attempt.provider}>
                <strong>{providerName(attempt.provider)}</strong>
                <span data-state={attempt.status}>{attempt.status}</span>
                <small>{attempt.resultCount}건 · {attempt.latencyMs}ms · {attempt.detail}</small>
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="provider-actions">
        <button className="button button-secondary" type="button" disabled={probing || loading} onClick={() => void runProbe()}>
          {probing ? "검색 테스트 중" : `${activeName} 연결 테스트`}
        </button>
        <button className="text-button" type="button" disabled={loading} onClick={() => void load()}>상태 새로고침</button>
      </div>
      <small className="internet-search-operations__security">API Key는 서버 Secret으로만 관리하며 브라우저에 전달하지 않습니다. 우선순위 상위 공급자를 배치로 병렬 조회해 종합하고, 결과가 부족할 때만 다음 배치로 확장합니다.</small>
    </article>
  );
}
