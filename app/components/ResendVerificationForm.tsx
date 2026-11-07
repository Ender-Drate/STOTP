"use client";

import { useState } from "react";

export function ResendVerificationForm({ defaultEmail }: { defaultEmail: string }) {
  const [email, setEmail] = useState(defaultEmail);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => null);
      setMsg({
        ok: res.ok,
        text: res.ok
          ? "如果该邮箱待验证，验证邮件已发送"
          : data?.error?.message || "发送失败，请稍后重试",
      });
    } catch {
      setMsg({ ok: false, text: "网络错误，请重试" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {msg ? <div className={`notice ${msg.ok ? "notice-ok" : "notice-error"}`}>{msg.text}</div> : null}
      <div className="field">
        <label className="label" htmlFor="resend-email">邮箱</label>
        <input id="resend-email" className="input" type="email" value={email}
          onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "发送中…" : "重新发送验证邮件"}
      </button>
    </form>
  );
}
