"use client";

import { useEffect, useState } from "react";

export default function VerifyEmailPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setToken(new URLSearchParams(window.location.search).get("token") || ""), []);

  const verify = async () => {
    if (!token || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || "이메일 인증을 완료하지 못했습니다.");
      window.history.replaceState({}, "", "/verify-email");
      window.location.replace("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "이메일 인증을 완료하지 못했습니다.");
      setBusy(false);
    }
  };

  return <main className="access-gate"><section className="access-gate-card" aria-live="polite">
    <h1>이메일 인증</h1>
    <p>아래 버튼을 눌러 이메일 주소 확인을 완료해 주세요.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button button-primary" type="button" onClick={() => void verify()} disabled={!token || busy}>
      {busy ? "인증 중" : "이메일 인증 완료"}
    </button>
  </section></main>;
}
