"use client";

import { useEffect, useState } from "react";
import "./RequirementsChecklist.css";

type Requirement = { id: string; title?: string; label?: string; status?: string; note?: string; owner?: string };
type Payload = {
  requirements?: Requirement[];
  outstanding?: Requirement[];
  summary?: { total?: number; done?: number; outstanding?: number };
};

export function RequirementsChecklist() {
  const [data, setData] = useState<Payload>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [onlyOutstanding, setOnlyOutstanding] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/requirements", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as Payload & { error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message || "요구사항을 불러오지 못했습니다.");
        return payload;
      })
      .then(setData)
      .catch((cause: Error) => { if (cause.name !== "AbortError") setError(cause.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const items = (onlyOutstanding ? data?.outstanding : data?.requirements) ?? [];
  const summary = data?.summary;

  return (
    <section className="panel requirements-panel">
      <div className="panel-title">
        <div><span className="section-kicker">REQUIREMENTS</span><h2>개발 요구사항 체크리스트</h2></div>
        {summary ? <span>{summary.outstanding ?? items.length}건 미해소</span> : null}
      </div>

      <label className="requirements-toggle">
        <input type="checkbox" checked={onlyOutstanding} onChange={(e) => setOnlyOutstanding(e.target.checked)} />
        미해소 항목만 보기
      </label>

      {loading ? <p className="agent-ops-note">불러오는 중…</p>
        : error ? <p className="agent-ops-error" role="alert">{error}</p>
        : !items.length ? <p className="agent-ops-note">{onlyOutstanding ? "미해소 요구사항이 없습니다." : "등록된 요구사항이 없습니다."}</p>
        : (
          <ul className="requirement-list">
            {items.map((item) => (
              <li key={item.id} className="requirement-row">
                <span className="requirement-id mono">{item.id}</span>
                <div>
                  <strong>{item.title || item.label || item.id}</strong>
                  {item.note ? <small>{item.note}</small> : null}
                </div>
                {item.status ? <span className={`status-pill status-${item.status}`}>{item.status}</span> : null}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
