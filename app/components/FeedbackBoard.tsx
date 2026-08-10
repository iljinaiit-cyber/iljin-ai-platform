"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import "./FeedbackBoard.css";

type FeedbackCategory = "feature" | "bug" | "question" | "other" | "notice";
type FeedbackStatus = "received" | "reviewing" | "resolved";

type FeedbackComment = {
  id: string;
  content: string;
  authorName: string;
  authorDepartment?: string;
  isMine: boolean;
  createdAt: string;
};

type FeedbackPost = {
  id: string;
  category: FeedbackCategory;
  title: string;
  content: string;
  isNotice: boolean;
  status: FeedbackStatus;
  authorName: string;
  authorDepartment?: string;
  isMine: boolean;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
  comments: FeedbackComment[];
};

type Capabilities = { canModerate: boolean; canNotice: boolean };

const categoryLabels: Record<FeedbackCategory, string> = {
  feature: "기능 제안",
  bug: "오류 신고",
  question: "사용 문의",
  other: "기타 의견",
  notice: "공지",
};

const statusLabels: Record<FeedbackStatus, string> = {
  received: "접수",
  reviewing: "검토 중",
  resolved: "완료",
};

const filters: Array<{ value: "all" | FeedbackCategory; label: string }> = [
  { value: "all", label: "전체" },
  { value: "notice", label: "공지" },
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
  const [likeSavingId, setLikeSavingId] = useState<string | null>(null);
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null);
  const [commentSavingId, setCommentSavingId] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [noticeSaving, setNoticeSaving] = useState(false);
  const [capabilities, setCapabilities] = useState<Capabilities>({ canModerate: false, canNotice: false });
  const [draft, setDraft] = useState({ category: "feature" as FeedbackCategory, title: "", content: "" });
  const [noticeDraft, setNoticeDraft] = useState({ title: "", content: "" });

  const loadPosts = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/feedback", { cache: "no-store" });
      const payload = await response.json() as { items?: FeedbackPost[]; capabilities?: Capabilities; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "게시글을 불러오지 못했습니다.");
      setPosts(payload.items || []);
      if (payload.capabilities) setCapabilities(payload.capabilities);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "게시글을 불러오지 못했습니다.");
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
      if (!response.ok || !payload.item) throw new Error(payload.error?.message || "게시글을 등록하지 못했습니다.");
      setPosts((current) => [payload.item!, ...current]);
      setDraft({ category: "feature", title: "", content: "" });
      setNotice("게시글이 등록되었습니다.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "게시글을 등록하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const submitNotice = async (event: FormEvent) => {
    event.preventDefault();
    const title = noticeDraft.title.trim();
    const content = noticeDraft.content.trim();
    if (!title || !content || noticeSaving) return;
    setNoticeSaving(true);
    setError("");
    try {
      const response = await fetch("/api/v1/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ category: "notice", isNotice: true, title, content }),
      });
      const payload = await response.json() as { item?: FeedbackPost; error?: { message?: string } };
      if (!response.ok || !payload.item) throw new Error(payload.error?.message || "공지를 등록하지 못했습니다.");
      setPosts((current) => [payload.item!, ...current]);
      setNoticeDraft({ title: "", content: "" });
      setNotice("공지가 등록되었습니다.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "공지를 등록하지 못했습니다.");
    } finally {
      setNoticeSaving(false);
    }
  };

  const toggleLike = async (post: FeedbackPost) => {
    if (likeSavingId) return;
    setLikeSavingId(post.id);
    try {
      const response = await fetch("/api/v1/feedback/" + encodeURIComponent(post.id) + "/like", { method: "POST" });
      const payload = await response.json() as { liked?: boolean; likeCount?: number; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "좋아요를 처리하지 못했습니다.");
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, likedByMe: Boolean(payload.liked), likeCount: Number(payload.likeCount || 0) } : item));
    } catch (likeError) {
      setError(likeError instanceof Error ? likeError.message : "좋아요를 처리하지 못했습니다.");
    } finally {
      setLikeSavingId(null);
    }
  };

  const submitComment = async (event: FormEvent, postId: string) => {
    event.preventDefault();
    const content = (commentDrafts[postId] || "").trim();
    if (!content || commentSavingId) return;
    setCommentSavingId(postId);
    try {
      const response = await fetch("/api/v1/feedback/" + encodeURIComponent(postId) + "/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ content }),
      });
      const payload = await response.json() as { item?: FeedbackComment; error?: { message?: string } };
      if (!response.ok || !payload.item) throw new Error(payload.error?.message || "댓글을 등록하지 못했습니다.");
      setPosts((current) => current.map((item) => item.id === postId ? { ...item, comments: [...item.comments, payload.item!], commentCount: item.commentCount + 1 } : item));
      setCommentDrafts((current) => ({ ...current, [postId]: "" }));
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : "댓글을 등록하지 못했습니다.");
    } finally {
      setCommentSavingId(null);
    }
  };

  const updateStatus = async (post: FeedbackPost, status: "reviewing" | "resolved") => {
    if (statusSavingId) return;
    setStatusSavingId(post.id);
    try {
      const response = await fetch("/api/v1/feedback/" + encodeURIComponent(post.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json() as { status?: FeedbackStatus; error?: { message?: string } };
      if (!response.ok || !payload.status) throw new Error(payload.error?.message || "상태를 변경하지 못했습니다.");
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, status: payload.status! } : item));
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "상태를 변경하지 못했습니다.");
    } finally {
      setStatusSavingId(null);
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
          <div className="panel-title"><div><h2 id="feedback-list-title">게시글 목록</h2><p className="panel-description">댓글과 좋아요로 의견을 함께 남길 수 있습니다.</p></div><button className="button button-secondary feedback-refresh" type="button" onClick={() => void loadPosts()} disabled={loading}>새로고침</button></div>
          <div className="feedback-filters" role="tablist" aria-label="게시글 분류">
            {filters.map((item) => <button key={item.value} type="button" role="tab" aria-selected={filter === item.value} className={filter === item.value ? "selected" : ""} onClick={() => setFilter(item.value)}>{item.label}</button>)}
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          {notice && <p className="feedback-notice" role="status">{notice}</p>}
          {loading ? <p className="empty-state">게시글을 불러오는 중입니다.</p> : visiblePosts.length === 0 ? <p className="empty-state">등록된 게시글이 없습니다.</p> : <div className="feedback-post-list">
            {visiblePosts.map((post) => {
              const isOpen = openPostId === post.id;
              return <article className={"feedback-post " + (isOpen ? "is-open" : "")} key={post.id}>
                <button className="feedback-post-summary" type="button" aria-expanded={isOpen} onClick={() => setOpenPostId(isOpen ? null : post.id)}>
                  <span className={"feedback-category feedback-category-" + (post.isNotice ? "notice" : post.category)}>{post.isNotice ? "공지" : categoryLabels[post.category]}</span>
                  <span className="feedback-post-main"><strong>{post.title}</strong><span className="feedback-author"><span className="feedback-author-avatar" aria-hidden="true">{post.authorName.slice(0, 1)}</span><span><b>{post.authorName}{post.isMine ? " · 내 게시글" : ""}</b><small>{post.authorDepartment ? post.authorDepartment + " · " : ""}{formatDate(post.createdAt)}</small></span></span></span>
                  <span className={"status-pill feedback-status-" + post.status}>{statusLabels[post.status]}</span>
                </button>
                {isOpen && <div className="feedback-post-content">
                  <p>{post.content}</p>
                  <div className="feedback-post-toolbar">
                    <button type="button" className={"feedback-like-button " + (post.likedByMe ? "liked" : "")} onClick={() => void toggleLike(post)} disabled={likeSavingId === post.id}>좋아요 {post.likeCount}</button>
                    <span className="feedback-comment-count">댓글 {post.commentCount}</span>
                    {capabilities.canModerate && !post.isNotice && <span className="feedback-moderation-actions"><button type="button" onClick={() => void updateStatus(post, "reviewing")} disabled={statusSavingId === post.id || post.status === "reviewing"}>검토 중</button><button type="button" onClick={() => void updateStatus(post, "resolved")} disabled={statusSavingId === post.id || post.status === "resolved"}>완료</button></span>}
                  </div>
                  <div className="feedback-comments">
                    <h3>댓글 {post.commentCount}</h3>
                    {post.comments.length > 0 ? <div className="feedback-comment-list">{post.comments.map((comment) => <div className="feedback-comment" key={comment.id}><span className="feedback-author-avatar" aria-hidden="true">{comment.authorName.slice(0, 1)}</span><div><strong>{comment.authorName}{comment.isMine ? " · 나" : ""}</strong><small>{comment.authorDepartment ? comment.authorDepartment + " · " : ""}{formatDate(comment.createdAt)}</small><p>{comment.content}</p></div></div>)}</div> : <p className="feedback-comment-empty">첫 댓글을 남겨 주세요.</p>}
                    <form className="feedback-comment-form" onSubmit={(event) => void submitComment(event, post.id)}><input value={commentDrafts[post.id] || ""} onChange={(event) => setCommentDrafts((current) => ({ ...current, [post.id]: event.target.value }))} maxLength={2000} placeholder="댓글을 입력해 주세요" aria-label={post.title + " 댓글"} /><button className="button button-secondary" type="submit" disabled={commentSavingId === post.id || !(commentDrafts[post.id] || "").trim()}>댓글 등록</button></form>
                  </div>
                </div>}
              </article>;
            })}
          </div>}
        </section>

        <section className="panel feedback-form-panel" aria-labelledby="feedback-form-title">
          <div><span className="section-kicker">SHARE AN IDEA</span><h2 id="feedback-form-title">의견 남기기</h2><p className="panel-description">개선점과 사용 경험을 남겨 주세요.</p></div>
          <form className="feedback-form" onSubmit={submit}>
            <label>분류<select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as FeedbackCategory }))}><option value="feature">기능 제안</option><option value="bug">오류 신고</option><option value="question">사용 문의</option><option value="other">기타 의견</option></select></label>
            <label>제목<input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} maxLength={120} placeholder="게시글 제목을 입력해 주세요" required /></label>
            <label>내용<textarea value={draft.content} onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} maxLength={5000} rows={7} placeholder="의견 내용을 입력해 주세요" required /></label>
            <div className="feedback-form-foot"><small>{draft.content.length.toLocaleString("ko-KR")} / 5,000자</small><button className="button button-primary" type="submit" disabled={saving || !draft.title.trim() || !draft.content.trim()}>{saving ? "등록 중" : "게시글 등록"}</button></div>
          </form>
          {capabilities.canNotice && <form className="feedback-notice-form" onSubmit={submitNotice}><div><span className="section-kicker">ADMIN</span><h2>공지 등록</h2><p className="panel-description">관리자에게만 표시되는 공지 등록 영역입니다.</p></div><label>공지 제목<input value={noticeDraft.title} onChange={(event) => setNoticeDraft((current) => ({ ...current, title: event.target.value }))} maxLength={120} placeholder="공지 제목을 입력해 주세요" required /></label><label>공지 내용<textarea value={noticeDraft.content} onChange={(event) => setNoticeDraft((current) => ({ ...current, content: event.target.value }))} maxLength={5000} rows={5} placeholder="공지 내용을 입력해 주세요" required /></label><button className="button button-secondary" type="submit" disabled={noticeSaving || !noticeDraft.title.trim() || !noticeDraft.content.trim()}>{noticeSaving ? "등록 중" : "공지 등록"}</button></form>}
        </section>
      </div>
    </div>
  );
}
