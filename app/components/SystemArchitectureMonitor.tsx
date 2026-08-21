"use client";

import { useCallback, useEffect, useState } from "react";
import "./SystemArchitectureMonitor.css";

type Overview = {
  generatedAt: string;
  usage?: {
    users?: { active30d?: number };
    agentRuns24h?: { total?: number; failed?: number };
    llm24h?: { total?: number; averageLatencyMs?: number | null };
    retrieval24h?: { total?: number; averageLatencyMs?: number | null };
  };
  management?: { assets?: { indexed?: number; segments?: number }; failedIndexJobs?: number };
};

type Health = {
  status?: string;
  gateway?: { configured?: boolean; model?: string };
  rag?: { d1Configured?: boolean; r2Configured?: boolean; embeddingConfigured?: boolean; rerankConfigured?: boolean };
  bindings?: { db?: boolean; bucket?: boolean; vector_index?: boolean; ai?: boolean; index_queue?: boolean };
};

type Gate = { id: string; passed: boolean };
type NodeState = "ready" | "attention" | "offline";
type SystemNode = { id: string; group: string; title: string; detail: string; state: NodeState };

function number(value?: number | null) {
  return value === undefined || value === null ? "—" : value.toLocaleString("ko-KR");
}

function status(ready: boolean | undefined): NodeState {
  return ready ? "ready" : "attention";
}

export function SystemArchitectureMonitor() {
  const [overview, setOverview] = useState<Overview>();
  const [health, setHealth] = useState<Health>();
  const [gates, setGates] = useState<Gate[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date>();
  const [refreshing, setRefreshing] = useState(true);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const [selectedNode, setSelectedNode] = useState<SystemNode>();

  const load = useCallback(async (signal?: AbortSignal) => {
    setRefreshing(true);
    try {
      const [overviewResponse, healthResponse, gatesResponse] = await Promise.all([
        fetch("/api/admin/overview", { cache: "no-store", signal }),
        fetch("/api/health", { cache: "no-store", signal }),
        fetch("/api/admin/quality-gates", { cache: "no-store", signal }),
      ]);
      if (!overviewResponse.ok || !healthResponse.ok || !gatesResponse.ok) throw new Error("운영 데이터를 불러오지 못했습니다.");
      const [nextOverview, nextHealth, nextGates] = await Promise.all([
        overviewResponse.json() as Promise<Overview>,
        healthResponse.json() as Promise<Health>,
        gatesResponse.json() as Promise<{ gates?: Gate[] }>,
      ]);
      setOverview(nextOverview);
      setHealth(nextHealth);
      setGates(nextGates.gates || []);
      setLastUpdated(new Date());
      setError("");
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "운영 데이터를 불러오지 못했습니다.");
    } finally {
      if (!signal?.aborted) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (paused) return;
    const interval = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(interval);
  }, [load, paused]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedNode(undefined);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const nodes: SystemNode[] = [
    { id: "client", group: "접속", title: "사용자 포털", detail: `최근 30일 활성 사용자 ${number(overview?.usage?.users?.active30d)}명`, state: health ? "ready" : "offline" },
    { id: "edge", group: "애플리케이션", title: "Cloudflare Pages", detail: health?.status === "ready" ? "헬스 상태 정상" : "환경 설정 확인 필요", state: health ? status(health.status === "ready") : "offline" },
    { id: "gateway", group: "AI 처리", title: "LLM Gateway", detail: health?.gateway?.model || "모델 설정 확인 중", state: health ? status(health.gateway?.configured) : "offline" },
    { id: "ai", group: "AI 처리", title: "Workers AI", detail: `24시간 호출 ${number(overview?.usage?.llm24h?.total)}건`, state: health ? status(health.bindings?.ai) : "offline" },
    { id: "d1", group: "데이터", title: "D1 메타데이터", detail: `색인 자산 ${number(overview?.management?.assets?.indexed)}개`, state: health ? status(health.rag?.d1Configured && health.bindings?.db) : "offline" },
    { id: "r2", group: "데이터", title: "R2 원문 저장소", detail: "원본 문서 보관", state: health ? status(health.rag?.r2Configured && health.bindings?.bucket) : "offline" },
    { id: "vector", group: "검색", title: "Vectorize", detail: `검색 ${number(overview?.usage?.retrieval24h?.total)}건 / 24시간`, state: health ? status(health.bindings?.vector_index && health.rag?.embeddingConfigured) : "offline" },
    { id: "queue", group: "색인", title: "Index Queue", detail: `실패 작업 ${number(overview?.management?.failedIndexJobs)}건`, state: health ? status(health.bindings?.index_queue) : "offline" },
  ];
  const readyCount = nodes.filter((node) => node.state === "ready").length;
  const passedGates = gates.filter((gate) => gate.passed).length;
  const selectedDetails = selectedNode ? {
    client: [["최근 30일 활성 사용자", `${number(overview?.usage?.users?.active30d)}명`], ["상태 기준", "헬스 API 응답 수신"]],
    edge: [["헬스 상태", health?.status === "ready" ? "정상" : "환경 설정 확인 필요"], ["마지막 갱신", lastUpdated?.toLocaleTimeString("ko-KR") || "확인 중"]],
    gateway: [["구성 상태", health?.gateway?.configured ? "연결" : "확인 필요"], ["모델", health?.gateway?.model || "설정 정보 없음"], ["24시간 평균 응답", overview?.usage?.llm24h?.averageLatencyMs == null ? "—" : `${Math.round(overview.usage.llm24h.averageLatencyMs)}ms`]],
    ai: [["AI 바인딩", health?.bindings?.ai ? "연결" : "확인 필요"], ["24시간 호출", `${number(overview?.usage?.llm24h?.total)}건`]],
    d1: [["D1 바인딩", health?.bindings?.db ? "연결" : "확인 필요"], ["RAG 구성", health?.rag?.d1Configured ? "정상" : "확인 필요"], ["색인 자산", `${number(overview?.management?.assets?.indexed)}개`]],
    r2: [["R2 바인딩", health?.bindings?.bucket ? "연결" : "확인 필요"], ["RAG 구성", health?.rag?.r2Configured ? "정상" : "확인 필요"]],
    vector: [["Vectorize 바인딩", health?.bindings?.vector_index ? "연결" : "확인 필요"], ["임베딩 구성", health?.rag?.embeddingConfigured ? "정상" : "확인 필요"], ["24시간 검색", `${number(overview?.usage?.retrieval24h?.total)}건`], ["평균 응답", overview?.usage?.retrieval24h?.averageLatencyMs == null ? "—" : `${Math.round(overview.usage.retrieval24h.averageLatencyMs)}ms`]],
    queue: [["Queue 바인딩", health?.bindings?.index_queue ? "연결" : "확인 필요"], ["실패 작업", `${number(overview?.management?.failedIndexJobs)}건`]],
  }[selectedNode.id] : [];

  return (
    <section className="system-monitor" aria-labelledby="system-monitor-title">
      <header className="system-monitor__header">
        <div>
          <span className="section-kicker">SYSTEM ARCHITECTURE</span>
          <h2 id="system-monitor-title">시스템 구조 및 실시간 운영 현황</h2>
          <p>실제 배포 바인딩과 운영 집계를 20초 간격으로 갱신합니다.</p>
        </div>
        <div className="system-monitor__actions">
          <span className={`system-monitor__live ${paused ? "is-paused" : ""}`} role="status"><i />{paused ? "자동 갱신 일시정지" : "실시간 모니터링"}</span>
          <button type="button" onClick={() => setPaused((value) => !value)}>{paused ? "자동 갱신 재개" : "일시정지"}</button>
          <button type="button" onClick={() => void load()} disabled={refreshing}>{refreshing ? "갱신 중" : "지금 갱신"}</button>
        </div>
      </header>

      {error && <p className="system-monitor__error" role="alert">{error}</p>}
      <div className="system-monitor__summary" aria-label="운영 요약">
        <div><span>정상 노드</span><strong>{readyCount}/{nodes.length}</strong></div>
        <div><span>품질 게이트</span><strong>{passedGates}/{gates.length || "—"}</strong></div>
        <div><span>Agent 실행</span><strong>{number(overview?.usage?.agentRuns24h?.total)}</strong><small>실패 {number(overview?.usage?.agentRuns24h?.failed)} · 24시간</small></div>
        <div><span>LLM 평균 응답</span><strong>{overview?.usage?.llm24h?.averageLatencyMs == null ? "—" : `${Math.round(overview.usage.llm24h.averageLatencyMs)}ms`}</strong><small>검색 평균 {overview?.usage?.retrieval24h?.averageLatencyMs == null ? "—" : `${Math.round(overview.usage.retrieval24h.averageLatencyMs)}ms`}</small></div>
      </div>

      <div className="system-monitor__diagram" aria-label="플랫폼 시스템 구조">
        <svg className="system-diagram-lines" viewBox="0 0 1000 480" preserveAspectRatio="none" aria-hidden="true">
          <defs><marker id="system-diagram-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
          <path d="M 170 240 H 255" markerEnd="url(#system-diagram-arrow)" />
          <path d="M 405 240 H 435 V 115 H 450" markerEnd="url(#system-diagram-arrow)" />
          <path d="M 600 115 H 665" markerEnd="url(#system-diagram-arrow)" />
          <path d="M 405 240 H 435 V 365 H 450" markerEnd="url(#system-diagram-arrow)" />
          <path d="M 600 365 H 665" markerEnd="url(#system-diagram-arrow)" />
          <path d="M 785 115 H 830 V 240 H 850" markerEnd="url(#system-diagram-arrow)" />
          <path d="M 600 365 H 830 V 240 H 850" markerEnd="url(#system-diagram-arrow)" />
          <path d="M 785 365 H 850" markerEnd="url(#system-diagram-arrow)" />
        </svg>
        {nodes.map((node) => <button key={node.id} type="button" className={`system-node system-node--${node.state} system-node--${node.id}`} onClick={() => setSelectedNode(node)} aria-haspopup="dialog">
          <span className="system-node__group"><i aria-hidden="true" />{node.group}</span>
          <h3>{node.title}</h3><p>{node.detail}</p>
          <span className="system-node__footer"><b>{node.state === "ready" ? "정상" : node.state === "offline" ? "확인 중" : "확인 필요"}</b><em>상세 보기</em></span>
        </button>)}
      </div>
      <footer className="system-monitor__footer">
        <span>범례: <i className="state-ready" /> 정상 <i className="state-attention" /> 확인 필요</span>
        <span>{lastUpdated ? `마지막 갱신 ${lastUpdated.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "초기 데이터를 불러오는 중"}</span>
      </footer>
      {selectedNode && <div className="system-modal-backdrop" role="presentation" onMouseDown={() => setSelectedNode(undefined)}>
        <section className={`system-modal system-modal--${selectedNode.state}`} role="dialog" aria-modal="true" aria-labelledby="system-modal-title" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div><span>{selectedNode.group}</span><h3 id="system-modal-title">{selectedNode.title} 상세 현황</h3></div>
            <button type="button" onClick={() => setSelectedNode(undefined)} aria-label="상세 현황 닫기">닫기</button>
          </header>
          <p className="system-modal__status"><i />{selectedNode.state === "ready" ? "정상 운영 중" : selectedNode.state === "offline" ? "상태 확인 중" : "점검이 필요합니다"}</p>
          <dl>{(selectedDetails || []).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          <footer><span>자동 갱신: {paused ? "일시정지" : "20초 간격"}</span><span>{lastUpdated ? `기준 ${lastUpdated.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "갱신 중"}</span></footer>
        </section>
      </div>}
    </section>
  );
}
