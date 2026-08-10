"use client";

import { useCallback, useEffect, useState } from "react";

type Control = {
  id: string; title?: string; label?: string;
  status: "implemented" | "partial" | "not_implemented" | "unknown" | string;
  source?: string; evidence?: string; gaps?: string[]; checked_at?: string;
};
type Tower = { controls?: Control[]; slo?: Array<{ key: string; target?: string; current?: string }> };
type SupportingData = {
  readiness?: Record<string, unknown>;
  providers?: Record<string, unknown>;
  observability?: Record<string, unknown>;
};

// 4상태 체계. unknown 은 "확인되지 않음"이며 통과가 아니다 — 08 §8.8.1.
const STATUS: Record<string, { label: string; tone: string }> = {
  implemented: { label: "구현됨", tone: "ok" },
  partial: { label: "부분 구현", tone: "warn" },
  not_implemented: { label: "미구현", tone: "bad" },
  unknown: { label: "확인 필요", tone: "unknown" },
};

export function AiControlTower({ currentEmail }: { currentEmail: string }) {
  const [data, setData] = useState<Tower>();
  const [supporting, setSupporting] = useState<SupportingData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [response, readinessResponse, providersResponse, observabilityResponse] = await Promise.all([
        fetch("/api/admin/control-tower", { cache: "no-store", signal }),
        fetch("/api/admin/readiness", { cache: "no-store", signal }),
        fetch("/api/admin/providers", { cache: "no-store", signal }),
        fetch("/api/admin/observability", { cache: "no-store", signal }),
      ]);
      const payload = await response.json() as Tower & { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "통제 상태를 불러오지 못했습니다.");
      const [readiness, providers, observability] = await Promise.all([
        readinessResponse.json(), providersResponse.json(), observabilityResponse.json(),
      ]) as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];
      setData(payload);
      setSupporting({ readiness, providers, observability });
      setError("");
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "통제 상태를 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // load() 를 여기서 바로 부르면 내부 setState 가 effect 와 같은 틱에 돌아
    // 연쇄 렌더가 된다. 마이크로태스크로 한 틱 미룬다.
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const controls = data?.controls ?? [];
  const unknownCount = controls.filter((c) => c.status === "unknown").length;
  const providerAction = async (action: "probe_all" | "reset_circuit") => {
    await fetch("/api/admin/providers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "reset_circuit" ? { action, provider: "cloudflare" } : { action }),
    });
    await load();
  };

  return (
    <section className="panel control-tower">
      <div className="panel-title">
        <div><span className="section-kicker">CONTROL TOWER</span><h2>보안 · 거버넌스 통제 상태</h2></div>
        <span>{currentEmail}</span>
      </div>

      {/* unknown 이 하나라도 있으면 경영진 보고용 내보내기를 막는다.
          상태를 모르는 채로 "안전하다"고 보고하는 것을 구조적으로 차단한다. */}
      {unknownCount > 0 ? (
        <p className="tower-banner" role="alert">
          확인되지 않은 통제 {unknownCount}건이 있어 <strong>보고용 내보내기가 차단</strong>되었습니다.
          각 항목의 증거를 확보한 뒤 다시 시도해 주세요.
        </p>
      ) : null}

      <div className="governance-grid" aria-label="운영 준비 상태">
        <div><span className="section-kicker">PRODUCTION GATE</span><h3>운영 준비도</h3><p>{supporting.readiness ? "프로브 결과 연결됨" : "확인 중"}</p></div>
        <div><h3>Cloud LLM 모델 리소스 연동</h3><p>2단계 LLM 라우팅 · Provider 사용량·폴백·지연</p><button type="button" onClick={() => void providerAction("probe_all")}>전체 연결 테스트</button></div>
        <div><h3>관측성</h3><p>{supporting.observability ? "테넌트별 텔레메트리 연결됨" : "확인 중"}</p><p>Query Rewrite · Hybrid RRF · Reranker · Verifier</p><p>RRF 융합 · 근거 부족 차단 · 임베딩·Vector DB 복구</p><button type="button" onClick={() => void providerAction("probe_all")}>연결 테스트</button><button type="button" onClick={() => void providerAction("reset_circuit")}>Circuit 초기화</button></div>
      </div>

      {loading ? <p className="agent-ops-note">불러오는 중…</p>
        : error ? <p className="agent-ops-error" role="alert">{error}</p>
        : !controls.length ? <p className="agent-ops-note">등록된 통제가 없습니다.</p>
        : (
          <ul className="control-list">
            {[...controls].sort((a, b) => (a.status === "unknown" ? -1 : b.status === "unknown" ? 1 : 0)).map((control) => {
              const meta = STATUS[control.status] ?? { label: control.status, tone: "unknown" };
              return (
                <li key={control.id} className={`control-row control-row--${meta.tone}`}>
                  <div className="control-head">
                    <strong>{control.title || control.label || control.id}</strong>
                    <span className={`status-pill status-${meta.tone}`}>{meta.label}</span>
                  </div>
                  <div className="control-meta">
                    {control.source ? <span>{control.source}</span> : null}
                    {control.checked_at ? <span>확인 · {new Date(control.checked_at).toLocaleString("ko-KR")}</span> : null}
                  </div>
                  {control.evidence ? <p className="control-evidence">{control.evidence}</p> : null}
                  {control.gaps?.length ? (
                    <ul className="control-gaps">{control.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

      <button type="button" className="primary-button" disabled={unknownCount > 0}>
        {unknownCount > 0 ? "보고용 내보내기 차단됨" : "보고용 내보내기"}
      </button>
    </section>
  );
}
