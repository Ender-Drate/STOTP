"use client";

import { useEffect, useState } from "react";

export function ResendVerificationForm({ defaultEmail }: { defaultEmail: string }) {
  const [email, setEmail] = useState(defaultEmail);
  const [editing, setEditing] = useState(!defaultEmail);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error?.message || "发送失败，请稍后重试" });
        return;
      }
      setEditing(false);
      setCooldown(60);
      setMsg({ ok: true, text: "验证邮件已重新发送，请检查收件箱和垃圾邮件。" });
    } catch {
      setMsg({ ok: false, text: "网络错误，请重试" });
    } finally {
      setBusy(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void send();
  }

  return (
    <div className="resend-box">
      {msg ? <div className={`notice ${msg.ok ? "notice-ok" : "notice-error"}`}>{msg.text}</div> : null}
      {editing ? (
        <form onSubmit={submit} className="resend-form">
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="resend-email">邮箱</label>
            <input id="resend-email" className="input" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
          </div>
          <button className="btn btn-primary btn-sm" disabled={busy}>
            {busy ? "发送中…" : "发送验证邮件"}
          </button>
        </form>
      ) : (
        <div className="resend-row">
          <span className="small muted">没收到邮件？请检查垃圾邮件，或</span>
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => void send()}
            disabled={busy || cooldown > 0}>
            {busy ? "发送中…" : cooldown > 0 ? `${cooldown}s 后可重发` : "重新发送"}
          </button>
        </div>
      )}
    </div>
  );
}
