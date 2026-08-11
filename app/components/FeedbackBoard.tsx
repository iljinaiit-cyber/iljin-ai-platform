"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import "./FeedbackBoard.css";

type FeedbackCategory = "feature" | "bug" | "question" | "other" | "notice";
type FeedbackStatus = "received" | "reviewing" | "resolved";
type FeedbackComment = { id: string; postId: string; content: string; authorName: string; authorDepartment?: string; isMine: boolean; createdAt: string };
type FeedbackPost = { id: string; category: FeedbackCategory; title: string; content: string; isNotice: boolean; status: FeedbackStatus; authorName: string; authorDepartment?: string; isMine: boolean; createdAt: string; likeCount: number; likedByMe: boolean; commentCount: number; comments: FeedbackComment[] };
type Capabilities = { canModerate: boolean; canNotice: boolean; canEditAny: boolean };
type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

const text = {
  all: "\uC804\uCCB4", notice: "\uACF5\uC9C0", feature: "\uAE30\uB2A5 \uC81C\uC548", bug: "\uC624\uB958 \uC2E0\uACE0", question: "\uC0AC\uC6A9 \uBB38\uC758", other: "\uAE30\uD0C0 \uC758\uACAC",
  received: "\uC811\uC218", reviewing: "\uAC80\uD1A0 \uC911", resolved: "\uC644\uB8CC", mine: "\uB0B4 \uAC8C\uC2DC\uAE00",
  edit: "\uC218\uC815", save: "\uC800\uC7A5", cancel: "\uCDE8\uC18C", noticeOn: "\uACF5\uC9C0 \uC9C0\uC815", noticeOff: "\uACF5\uC9C0 \uD574\uC81C",
  previous: "\uC774\uC804", next: "\uB2E4\uC74C", title: "\uC81C\uBAA9", category: "\uBD84\uB958", content: "\uB0B4\uC6A9",
};
const categoryLabels: Record<FeedbackCategory, string> = { feature: text.feature, bug: text.bug, question: text.question, other: text.other, notice: text.notice };
const statusLabels: Record<FeedbackStatus, string> = { received: text.received, reviewing: text.reviewing, resolved: text.resolved };
const filters: Array<{ value: "all" | FeedbackCategory; label: string }> = [
  { value: "all", label: text.all }, { value: "notice", label: text.notice }, { value: "feature", label: text.feature }, { value: "bug", label: text.bug }, { value: "question", label: text.question }, { value: "other", label: text.other },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export function FeedbackBoard() {
  const [posts, setPosts] = useState<FeedbackPost[]>([]);
  const [filter, setFilter] = useState<"all" | FeedbackCategory>("all");
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 10, total: 0, totalPages: 1 });
  const [capabilities, setCapabilities] = useState<Capabilities>({ canModerate: false, canNotice: false, canEditAny: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [likeSavingId, setLikeSavingId] = useState<string | null>(null);
  const [commentSavingId, setCommentSavingId] = useState<string | null>(null);
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null);
  const [editSavingId, setEditSavingId] = useState<string | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [editDraft, setEditDraft] = useState({ title: "", content: "", category: "other" as FeedbackCategory });
  const [draft, setDraft] = useState({ category: "feature" as FeedbackCategory, title: "", content: "" });

  const loadPosts = useCallback(async (requestedPage = 1, requestedFilter: "all" | FeedbackCategory = "all") => {
    setLoading(true);
    setError("");
    try {
      const search = new URLSearchParams({ page: String(requestedPage) });
      if (requestedFilter !== "all") search.set("category", requestedFilter);
      const response = await fetch(`/api/v1/feedback?${search.toString()}`, { cache: "no-store" });
      const payload = await response.json() as { items?: FeedbackPost[]; pagination?: Pagination; capabilities?: Capabilities; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "\uAC8C\uC2DC\uAE00\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
      setPosts(payload.items || []);
      if (payload.pagination) setPagination(payload.pagination);
      if (payload.capabilities) setCapabilities(payload.capabilities);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "\uAC8C\uC2DC\uAE00\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadPosts(1, "all"); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadPosts]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const title = draft.title.trim();
    const content = draft.content.trim();
    if (!title || !content || saving) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/v1/feedback", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ ...draft, title, content }) });
      const payload = await response.json() as { item?: FeedbackPost; error?: { message?: string } };
      if (!response.ok || !payload.item) throw new Error(payload.error?.message || "\uAC8C\uC2DC\uAE00 \uB4F1\uB85D\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
      setDraft({ category: "feature", title: "", content: "" });
      setFilter("all");
      await loadPosts(1, "all");
      setMessage("\uAC8C\uC2DC\uAE00\uC774 \uB4F1\uB85D\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "\uAC8C\uC2DC\uAE00 \uB4F1\uB85D\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
    } finally { setSaving(false); }
  };

  const toggleLike = async (post: FeedbackPost) => {
    if (likeSavingId) return;
    setLikeSavingId(post.id);
    try {
      const response = await fetch(`/api/v1/feedback/${encodeURIComponent(post.id)}/like`, { method: "POST" });
      const payload = await response.json() as { liked?: boolean; likeCount?: number; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "\uC88B\uc544\uc694 \uCC98\uB9AC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, likedByMe: Boolean(payload.liked), likeCount: Number(payload.likeCount || 0) } : item));
    } catch (likeError) { setError(likeError instanceof Error ? likeError.message : "\uC88B\uc544\uc694 \uCC98\uB9AC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4."); }
    finally { setLikeSavingId(null); }
  };

  const submitComment = async (event: FormEvent, postId: string) => {
    event.preventDefault();
    const content = (commentDrafts[postId] || "").trim();
    if (!content || commentSavingId) return;
    setCommentSavingId(postId);
    try {
      const response = await fetch(`/api/v1/feedback/${encodeURIComponent(postId)}/comments`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ content }) });
      const payload = await response.json() as { item?: FeedbackComment; error?: { message?: string } };
      if (!response.ok || !payload.item) throw new Error(payload.error?.message || "\uB313\uae00 \uB4F1\uB85D\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
      setPosts((current) => current.map((item) => item.id === postId ? { ...item, comments: [...item.comments, payload.item!], commentCount: item.commentCount + 1 } : item));
      setCommentDrafts((current) => ({ ...current, [postId]: "" }));
    } catch (commentError) { setError(commentError instanceof Error ? commentError.message : "\uB313\uae00 \uB4F1\uB85D\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4."); }
    finally { setCommentSavingId(null); }
  };

  const updateStatus = async (post: FeedbackPost, status: "reviewing" | "resolved") => {
    if (statusSavingId) return;
    setStatusSavingId(post.id);
    try {
      const response = await fetch(`/api/v1/feedback/${encodeURIComponent(post.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ status }) });
      const payload = await response.json() as { status?: FeedbackStatus; error?: { message?: string } };
      if (!response.ok || !payload.status) throw new Error(payload.error?.message || "\uC0C1\uD0DC \uBCC0\uACBD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, status: payload.status! } : item));
    } catch (statusError) { setError(statusError instanceof Error ? statusError.message : "\uC0C1\uD0DC \uBCC0\uACBD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4."); }
    finally { setStatusSavingId(null); }
  };

  const startEdit = (post: FeedbackPost) => {
    setEditingPostId(post.id); setError("");
    setEditDraft({ title: post.title, content: post.content, category: post.category === "notice" ? "other" : post.category });
  };

  const saveEdit = async (event: FormEvent, post: FeedbackPost) => {
    event.preventDefault();
    const title = editDraft.title.trim(); const content = editDraft.content.trim();
    if (!title || !content || editSavingId) return;
    setEditSavingId(post.id); setError("");
    try {
      const response = await fetch(`/api/v1/feedback/${encodeURIComponent(post.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ title, content, category: editDraft.category }) });
      const payload = await response.json() as { item?: { title: string; content: string; category: FeedbackCategory; isNotice: boolean }; error?: { message?: string } };
      if (!response.ok || !payload.item) throw new Error(payload.error?.message || "\uAC8C\uC2DC\uAE00 \uC218\uC815\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, ...payload.item! } : item));
      setEditingPostId(null); setMessage("\uAC8C\uC2DC\uAE00\uC774 \uC218\uC815\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    } catch (editError) { setError(editError instanceof Error ? editError.message : "\uAC8C\uC2DC\uAE00 \uC218\uC815\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4."); }
    finally { setEditSavingId(null); }
  };

  const toggleNotice = async (post: FeedbackPost) => {
    if (editSavingId) return;
    setEditSavingId(post.id); setError("");
    try {
      const response = await fetch(`/api/v1/feedback/${encodeURIComponent(post.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ isNotice: !post.isNotice, category: post.isNotice ? "other" : "notice" }) });
      const payload = await response.json() as { item?: { title: string; content: string; category: FeedbackCategory; isNotice: boolean }; error?: { message?: string } };
      if (!response.ok || !payload.item) throw new Error(payload.error?.message || "\uACF5\C9C0 \uC124\uC815 \uBCC0\uACBD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, ...payload.item! } : item));
      setMessage(payload.item.isNotice ? "\uAC8C\uC2DC\uAE00\uC774 \uACF5\uC9C0\uB85C \uC9C0\uC815\uB418\uC5C8\uC2B5\uB2C8\uB2E4." : "\uACF5\uC9C0 \uC9C0\uC815\uC774 \uD574\uC81C\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    } catch (noticeError) { setError(noticeError instanceof Error ? noticeError.message : "\uACF5\uC9C0 \uC124\uC815 \uBCC0\uACBD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4."); }
    finally { setEditSavingId(null); }
  };

  return <div className="view-stack feedback-board">
    <div className="page-heading feedback-page-heading"><div><span className="section-kicker">USER VOICE</span><p>{"\uC11C\uBE44\uC2A4\uC5D0 \uB300\uD55C \uC81C\uC548\uACFC \uC758\uACAC\uC744 \uB0A8\uACA8 \uC8FC\uC138\uC694."}</p></div><span className="feedback-count">{text.all} {pagination.total}{"\uAC74"}</span></div>
    <div className="feedback-layout">
      <section className="panel feedback-list-panel" aria-labelledby="feedback-list-title">
        <div className="panel-title"><div><h2 id="feedback-list-title">{"\uAC8C\uC2DC\uAE00 \uBAA9\uB85D"}</h2><p className="panel-description">{"\uACF5\uC9C0\uB294 \uC0C1\uB2E8\uC5D0 \uACE0\uC815\uB418\uBA70, \uAC8C\uC2DC\uAE00\uC740 10\uAC1C\uC529 \uD45C\uC2DC\uB429\uB2C8\uB2E4."}</p></div><button className="button button-secondary feedback-refresh" type="button" onClick={() => void loadPosts(pagination.page, filter)} disabled={loading}>{"\uC0C8\uB85C\uACE0\CE68"}</button></div>
        <div className="feedback-filters" role="tablist" aria-label={"\uAC8C\uC2DC\uD310 \uBD84\uB958"}>{filters.map((item) => <button key={item.value} type="button" role="tab" aria-selected={filter === item.value} className={filter === item.value ? "selected" : ""} onClick={() => { setFilter(item.value); void loadPosts(1, item.value); }}>{item.label}</button>)}</div>
        {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="feedback-notice" role="status">{message}</p>}
        {loading ? <p className="empty-state">{"\uAC8C\uC2DC\uAE00\uC744 \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4."}</p> : posts.length === 0 ? <p className="empty-state">{"\uB4F1\uB85D\uB41C \uAC8C\uC2DC\uAE00\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</p> : <div className="feedback-post-list">{posts.map((post) => {
          const isOpen = openPostId === post.id;
          return <article className={`feedback-post ${isOpen ? "is-open" : ""}`} key={post.id}>
            <button className="feedback-post-summary" type="button" aria-expanded={isOpen} onClick={() => setOpenPostId(isOpen ? null : post.id)}><span className={`feedback-category feedback-category-${post.isNotice ? "notice" : post.category}`}>{post.isNotice ? text.notice : categoryLabels[post.category]}</span><span className="feedback-post-main"><strong>{post.title}</strong><span className="feedback-author"><span className="feedback-author-avatar" aria-hidden="true">{post.authorName.slice(0, 1)}</span><span><b>{post.authorName}{post.isMine ? ` · ${text.mine}` : ""}</b><small>{post.authorDepartment ? `${post.authorDepartment} · ` : ""}{formatDate(post.createdAt)}</small></span></span></span><span className={`status-pill feedback-status-${post.status}`}>{statusLabels[post.status]}</span></button>
            {isOpen && <div className="feedback-post-content">{editingPostId === post.id ? <form className="feedback-edit-form" onSubmit={(event) => void saveEdit(event, post)}><label>{text.title}<input value={editDraft.title} onChange={(event) => setEditDraft((current) => ({ ...current, title: event.target.value }))} maxLength={120} required /></label><label>{text.category}<select value={editDraft.category} onChange={(event) => setEditDraft((current) => ({ ...current, category: event.target.value as FeedbackCategory }))}><option value="feature">{text.feature}</option><option value="bug">{text.bug}</option><option value="question">{text.question}</option><option value="other">{text.other}</option></select></label><label>{text.content}<textarea value={editDraft.content} onChange={(event) => setEditDraft((current) => ({ ...current, content: event.target.value }))} maxLength={5000} rows={6} required /></label><div className="feedback-edit-actions"><button className="button button-primary" type="submit" disabled={editSavingId === post.id}>{text.save}</button><button className="button button-secondary" type="button" onClick={() => setEditingPostId(null)} disabled={editSavingId === post.id}>{text.cancel}</button></div></form> : <p>{post.content}</p>}
              <div className="feedback-post-toolbar"><button type="button" className={`feedback-like-button ${post.likedByMe ? "liked" : ""}`} onClick={() => void toggleLike(post)} disabled={likeSavingId === post.id}>{"\uC88B\uC544\uC694"} {post.likeCount}</button><span className="feedback-comment-count">{"\uB313\uae00"} {post.commentCount}</span>{(post.isMine || capabilities.canEditAny) && <button type="button" className="feedback-like-button" onClick={() => startEdit(post)} disabled={editSavingId === post.id}>{text.edit}</button>}{capabilities.canNotice && <button type="button" className="feedback-like-button" onClick={() => void toggleNotice(post)} disabled={editSavingId === post.id}>{post.isNotice ? text.noticeOff : text.noticeOn}</button>}{capabilities.canModerate && !post.isNotice && <span className="feedback-moderation-actions"><button className={post.status === "reviewing" ? "active" : ""} type="button" onClick={() => void updateStatus(post, "reviewing")} disabled={statusSavingId === post.id || post.status === "reviewing"}>{text.reviewing}</button><button className={post.status === "resolved" ? "active" : ""} type="button" onClick={() => void updateStatus(post, "resolved")} disabled={statusSavingId === post.id || post.status === "resolved"}>{text.resolved}</button></span>}</div>
              <div className="feedback-comments"><h3>{"\uB313\uae00"} {post.commentCount}</h3>{post.comments.length > 0 ? <div className="feedback-comment-list">{post.comments.map((comment) => <div className="feedback-comment" key={comment.id}><span className="feedback-author-avatar" aria-hidden="true">{comment.authorName.slice(0, 1)}</span><div><strong>{comment.authorName}{comment.isMine ? ` · ${text.mine}` : ""}</strong><small>{comment.authorDepartment ? `${comment.authorDepartment} · ` : ""}{formatDate(comment.createdAt)}</small><p>{comment.content}</p></div></div>)}</div> : <p className="feedback-comment-empty">{"\uCCAB \uB313\uae00\uC744 \uB0A8\uACA8 \uC8FC\uC138\uC694."}</p>}<form className="feedback-comment-form" onSubmit={(event) => void submitComment(event, post.id)}><input value={commentDrafts[post.id] || ""} onChange={(event) => setCommentDrafts((current) => ({ ...current, [post.id]: event.target.value }))} maxLength={2000} placeholder={"\uB313\uae00\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694."} aria-label={`${post.title} \uB313\uae00`} /><button className="button button-secondary" type="submit" disabled={commentSavingId === post.id || !(commentDrafts[post.id] || "").trim()}>{"\uB313\uae00 \uB4F1\uB85D"}</button></form></div>
            </div>}
          </article>;
        })}</div>}
        {pagination.totalPages > 1 && <nav className="feedback-pagination" aria-label={"\uAC8C\uC2DC\uAE00 \uD398\uC774\uC9C0"}><button type="button" className="feedback-page-button" onClick={() => void loadPosts(pagination.page - 1, filter)} disabled={pagination.page <= 1 || loading}>{text.previous}</button><span>{pagination.page} / {pagination.totalPages}</span><button type="button" className="feedback-page-button" onClick={() => void loadPosts(pagination.page + 1, filter)} disabled={pagination.page >= pagination.totalPages || loading}>{text.next}</button></nav>}
      </section>
      <section className="panel feedback-form-panel" aria-labelledby="feedback-form-title"><div><span className="section-kicker">SHARE AN IDEA</span><h2 id="feedback-form-title">{"\uC758\uACAC \uB0A8\uAE30\uAE30"}</h2><p className="panel-description">{"\uAC1C\uC120\uC810\uACFC \uC0AC\uC6A9 \uACBD\uD5D8\uC744 \uACF5\uC720\uD574 \uC8FC\uC138\uC694."}</p></div><form className="feedback-form" onSubmit={submit}><label>{text.category}<select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as FeedbackCategory }))}><option value="feature">{text.feature}</option><option value="bug">{text.bug}</option><option value="question">{text.question}</option><option value="other">{text.other}</option></select></label><label>{text.title}<input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} maxLength={120} placeholder={"\uAC8C\uC2DC\uAE00 \uC81C\uBAA9\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694."} required /></label><label>{text.content}<textarea value={draft.content} onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} maxLength={5000} rows={7} placeholder={"\uC758\uACAC \uB0B4\uC6A9\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694."} required /></label><div className="feedback-form-foot"><small>{draft.content.length.toLocaleString("ko-KR")} / 5,000{"\uC790"}</small><button className="button button-primary" type="submit" disabled={saving || !draft.title.trim() || !draft.content.trim()}>{saving ? "\uB4F1\uB85D \uC911" : "\uAC8C\uC2DC\uAE00 \uB4F1\uB85D"}</button></div></form></section>
    </div>
  </div>;
}
