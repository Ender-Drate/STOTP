"use client";

import { useState } from "react";

export function LinkAccountForm({ ticket, next }: { ticket: string; next: string }) {
  const [form, setForm] = useState({ username: "", password: "", code: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket, ...form, next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message || "绑定失败");
        return;
      }
      window.location.assign(data?.next || next || "/dashboard");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error ? <div className="auth-error">{error}</div> : null}
      <div className="field">
        <label className="label" htmlFor="link-user">本地用户名或邮箱</label>
        <input id="link-user" className="input" autoComplete="username" autoFocus
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })} required />
      </div>
      <div className="field">
        <label className="label" htmlFor="link-password">本地账号密码</label>
        <input id="link-password" className="input" type="password"
          autoComplete="current-password" value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })} required />
      </div>
      <div className="field">
        <label className="label" htmlFor="link-code">TOTP 验证码（如已启用）</label>
        <input id="link-code" className="input otp-input" inputMode="numeric"
          autoComplete="one-time-code" maxLength={6} value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, "").slice(0, 6) })}
          placeholder="000000" />
      </div>
      <button className="btn btn-primary" style={{ width: "100%", height: 42, marginTop: 10 }}
        disabled={busy}>
        {busy ? "绑定中…" : "绑定并登录"}
      </button>
    </form>
  );
}
