"use client";

import { useCallback, useEffect, useState } from "react";

type ControlStatus = "implemented" | "in_progress" | "gap" | "accepted_risk";
type Control = {
  id: string; framework: string; category: string; title: string; description: string; critical: boolean;
  status: ControlStatus; evidenceNote: string; referenceUrl: string; ownerEmail: string; dueDate: string;
};
type Slo = { key: string; label: string; unit: string; target: number; actual: number | null; state: "pass" | "fail" | "no_data" };
type Tower = {
  gate: { status: "ready" | "conditional" | "blocked"; reason: string };
  summary: { implemented: number; inProgress: number; gaps: number; acceptedRisk: number };
  controls: Control[]; slos: Slo[]; checkedAt: string;
};

const STATUS_LABEL: Record<ControlStatus, string> = {
  implemented: "구현됨",
  in_progress: "진행 중",
  gap: "미해결",
  accepted_risk: "수용 위험",
};

export function AiControlTower({ currentEmail }: { currentEmail: string }) {
  const [data, setData] = useState<Tower>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/admin/control-tower", { cache: "no-store", signal });
      const payload = await response.json() as Tower & { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "통제 상태를 불러오지 못했습니다.");
      setData(payload);
      setError("");
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "통제 상태를 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const gate = data?.gate ?? { status: "conditional" as const, reason: "통제 상태를 확인하고 있습니다." };
  const gateBlocked = gate.status === "blocked";
  return (
    <section className="panel control-tower">
      <div className="control-hero">
        <div>
          <span className="section-kicker">CONTROL TOWER</span>
          <h2>보안 · 거버넌스 통제 상태</h2>
          <p>통제 증적과 운영 SLO를 함께 확인해 배포 판단의 근거를 제공합니다.</p>
          <small>{currentEmail}{data?.checkedAt ? ` · ${new Date(data.checkedAt).toLocaleString("ko-KR")}` : ""}</small>
        </div>
        <div className={`release-gate gate-${gate?.status || "conditional"}`}>
          <span>RELEASE GATE</span>
          <strong>{gate?.status === "ready" ? "배포 가능" : gateBlocked ? "배포 차단" : "조건부 검토"}</strong>
          <p>{gate?.reason || "통제 상태를 확인하고 있습니다."}</p>
        </div>
      </div>

      {data ? <div className="control-summary" aria-label="통제 요약">
        <article><span>구현됨</span><strong>{data.summary.implemented}</strong></article>
        <article><span>진행 중</span><strong>{data.summary.inProgress}</strong></article>
        <article><span>미해결</span><strong>{data.summary.gaps}</strong></article>
        <article><span>수용 위험</span><strong>{data.summary.acceptedRisk}</strong></article>
      </div> : null}

      {loading ? <p className="control-message">불러오는 중…</p>
        : error ? <p className="control-message error" role="alert">{error}</p>
        : <>
          <div className="control-card-grid">
            {(data?.controls || []).map((control) => <article key={control.id} className={`control-card control-${control.status}`}>
              <div className="control-card-top"><div><span className="control-id">{control.id}</span><span className="control-framework">{control.framework}</span></div>{control.critical ? <span className="critical-badge">필수</span> : null}</div>
              <h3>{control.title}</h3><p>{control.description}</p>
              <div className="control-fields"><label><span>상태</span><strong>{STATUS_LABEL[control.status]}</strong></label><label><span>책임자</span><strong>{control.ownerEmail || "미지정"}</strong></label></div>
              {control.evidenceNote ? <p>{control.evidenceNote}</p> : null}
              <div className="control-card-actions"><span>{control.dueDate ? `목표일 · ${control.dueDate}` : "목표일 미지정"}</span><a href={control.referenceUrl} target="_blank" rel="noreferrer">기준 보기</a></div>
            </article>)}
          </div>
          <div className="slo-grid">
            {(data?.slos || []).map((slo) => <article key={slo.key} className={`slo-card slo-${slo.state}`}><div className="slo-card-top"><span>{slo.label}</span><strong>{slo.state === "pass" ? "충족" : slo.state === "fail" ? "이탈" : "데이터 없음"}</strong></div><div className="slo-reading"><strong>{slo.actual ?? "—"}</strong><span>/ {slo.target}{slo.unit}</span></div></article>)}
          </div>
        </>}
    </section>
  );
}
