"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type FeedbackCategory = "feature" | "bug" | "question" | "other";
type FeedbackStatus = "received" | "reviewing" | "resolved";

type FeedbackPost = {
  id: string;
  category: FeedbackCategory;
  title: string;
  content: string;
  status: FeedbackStatus;
  authorName: string;
  isMine: boolean;
  createdAt: string;
};

const categoryLabels: Record<FeedbackCategory, string> = {
  feature: "기능 제안",
  bug: "오류 신고",
  question: "사용 문의",
  other: "기타 의견",
};

const statusLabels: Record<FeedbackStatus, string> = {
  received: "접수",
  reviewing: "검토 중",
  resolved: "반영 완료",
};

const filters: Array<{ value: "all" | FeedbackCategory; label: string }> = [
  { value: "all", label: "전체" },
  { value: "feature", label: "기능 제안" },
  { value: "bug", label: "오류 신고" },
  { value: "question", label: "사용 문의" },
  { value: "other", label: "기타 의견" },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export function FeedbackBoard() {
  const [posts, setPosts] = useState<FeedbackPost[]>([]);
  const [filter, setFilter] = useState<"all" | FeedbackCategory>("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ category: "feature" as FeedbackCategory, title: "", content: "" });

  const loadPosts = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/feedback", { cache: "no-store" });
      const payload = await response.json() as { items?: FeedbackPost[]; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "의견을 불러오지 못했습니다.");
      setPosts(payload.items || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "의견을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadPosts(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const visiblePosts = useMemo(
    () => filter === "all" ? posts : posts.filter((post) => post.category === filter),
    [filter, posts],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const title = draft.title.trim();
    const content = draft.content.trim();
    if (!title || !content || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/v1/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...draft, title, content }),
      });
      const payload = await response.json() as { item?: FeedbackPost; error?: { message?: string } };
      if (!response.ok || !payload.item) throw new Error(payload.error?.message || "의견을 등록하지 못했습니다.");
      setPosts((current) => [payload.item!, ...current]);
      setDraft({ category: "feature", title: "", content: "" });
      setNotice("의견이 등록되었습니다.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "의견을 등록하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="view-stack feedback-board">
      <div className="page-heading">
        <div><span className="section-kicker">USER VOICE</span><h1>사용자 의견</h1><p>서비스를 더 나아지게 만드는 의견을 남겨 주세요.</p></div>
        <span className="feedback-count">전체 {posts.length}건</span>
      </div>

      <div className="feedback-layout">
        <section className="panel feedback-list-panel" aria-labelledby="feedback-list-title">
          <div className="panel-title"><div><h2 id="feedback-list-title">의견 목록</h2><p className="panel-description">모든 사용자의 의견과 처리 상태를 확인할 수 있습니다.</p></div><button className="button button-secondary feedback-refresh" type="button" onClick={() => void loadPosts()} disabled={loading}>새로고침</button></div>
          <div className="feedback-filters" role="tablist" aria-label="의견 분류">
            {filters.map((item) => <button key={item.value} type="button" role="tab" aria-selected={filter === item.value} className={filter === item.value ? "selected" : ""} onClick={() => setFilter(item.value)}>{item.label}</button>)}
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          {notice && <p className="feedback-notice" role="status">{notice}</p>}
          {loading ? <p className="empty-state">의견을 불러오는 중입니다.</p> : visiblePosts.length === 0 ? <p className="empty-state">아직 등록된 의견이 없습니다. 첫 의견을 남겨 주세요.</p> : <div className="feedback-post-list">
            {visiblePosts.map((post) => {
              const isOpen = openPostId === post.id;
              return <article className={"feedback-post " + (isOpen ? "is-open" : "")} key={post.id}>
                <button className="feedback-post-summary" type="button" aria-expanded={isOpen} onClick={() => setOpenPostId(isOpen ? null : post.id)}>
                  <span className={"feedback-category feedback-category-" + post.category}>{categoryLabels[post.category]}</span>
                  <span className="feedback-post-main"><strong>{post.title}</strong><small>{post.authorName}{post.isMine ? " · 내 의견" : ""} · {formatDate(post.createdAt)}</small></span>
                  <span className={"status-pill feedback-status-" + post.status}>{statusLabels[post.status]}</span>
                </button>
                {isOpen && <div className="feedback-post-content"><p>{post.content}</p></div>}
              </article>;
            })}
          </div>}
        </section>

        <section className="panel feedback-form-panel" aria-labelledby="feedback-form-title">
          <div><span className="section-kicker">SHARE AN IDEA</span><h2 id="feedback-form-title">의견 남기기</h2><p className="panel-description">작은 개선점도 서비스 품질을 높이는 데 도움이 됩니다.</p></div>
          <form className="feedback-form" onSubmit={submit}>
            <label>분류<select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as FeedbackCategory }))}><option value="feature">기능 제안</option><option value="bug">오류 신고</option><option value="question">사용 문의</option><option value="other">기타 의견</option></select></label>
            <label>제목<input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} maxLength={120} placeholder="의견 제목을 입력해 주세요" required /></label>
            <label>내용<textarea value={draft.content} onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} maxLength={5000} rows={7} placeholder="어떤 점이 좋았는지, 무엇이 개선되면 좋을지 적어 주세요" required /></label>
            <div className="feedback-form-foot"><small>{draft.content.length.toLocaleString("ko-KR")} / 5,000자</small><button className="button button-primary" type="submit" disabled={saving || !draft.title.trim() || !draft.content.trim()}>{saving ? "등록 중" : "의견 등록"}</button></div>
          </form>
        </section>
      </div>
    </div>
  );
}
