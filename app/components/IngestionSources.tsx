"use client";

import { useCallback, useEffect, useState } from "react";
import "./IngestionSources.css";

type Source = {
  id: string; name?: string; source_type?: string; endpoint?: string;
  enabled?: number | boolean; schedule?: string;
  last_run_at?: string; last_status?: string; last_error?: string;
};

export function IngestionSources() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/admin/ingestion-sources", { cache: "no-store", signal });
      const payload = await response.json() as { sources?: Source[]; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "수집 소스를 불러오지 못했습니다.");
      setSources(payload.sources ?? []);
      setError("");
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "수집 소스를 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // load() 를 여기서 바로 부르면 내부 setState 가 effect 와 같은 틱에 돌아
    // 연쇄 렌더가 된다. 마이크로태스크로 한 틱 미룬다.
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const toggle = async (source: Source) => {
    if (busyId) return;
    setBusyId(source.id);
    try {
      const response = await fetch("/api/admin/ingestion-sources", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: source.id, enabled: !(source.enabled === true || source.enabled === 1) }),
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: { message?: string } };
        throw new Error(payload.error?.message || "설정을 변경하지 못했습니다.");
      }
      void load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "설정을 변경하지 못했습니다.");
    } finally { setBusyId(""); }
  };

  return (
    <section className="panel ingestion-panel">
      <div className="panel-title">
        <div><span className="section-kicker">INGESTION</span><h2>수집 소스</h2></div>
        <span>{sources.length}개</span>
      </div>

      {loading ? <p className="agent-ops-note">불러오는 중…</p>
        : error ? <p className="agent-ops-error" role="alert">{error}</p>
        : !sources.length ? <p className="agent-ops-note">등록된 수집 소스가 없습니다.</p>
        : (
          <ul className="source-list">
            {sources.map((source) => {
              const enabled = source.enabled === true || source.enabled === 1;
              return (
                <li key={source.id} className="source-row">
                  <span className={`status-dot ${enabled ? "" : "status-dot-warning"}`} />
                  <div>
                    <strong>{source.name || source.id}</strong>
                    <small>{source.source_type || "—"}{source.endpoint ? ` · ${source.endpoint}` : ""}</small>
                    {/* 마지막 실행 실패는 접어두지 않는다. 수집이 조용히 멈춘 것이 가장 위험하다. */}
                    {source.last_error ? <small className="source-error">{source.last_error}</small> : null}
                  </div>
                  <div className="source-meta">
                    {source.schedule ? <span className="mono">{source.schedule}</span> : null}
                    {source.last_run_at ? <span>{new Date(source.last_run_at).toLocaleString("ko-KR")}</span> : null}
                  </div>
                  <button type="button" className="text-button" disabled={busyId === source.id} onClick={() => void toggle(source)}>
                    {busyId === source.id ? "변경 중…" : enabled ? "중지" : "사용"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
    </section>
  );
}
