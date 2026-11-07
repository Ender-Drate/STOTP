"use client";

import { useState } from "react";
import { PasswordInput } from "./PasswordInput";
import { encryptPassword } from "@/lib/password-client";

export function LinkAccountForm({ ticket, next }: { ticket: string; next: string }) {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      let encrypted;
      try {
        encrypted = await encryptPassword(form.password);
      } catch {
        setError("当前环境无法加密密码，请使用 HTTPS 访问");
        return;
      }
      const res = await fetch("/api/auth/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket, username: form.username, next, ...encrypted }),
      });
      const data = await res.json().catch(() => null);
      if (data?.otp_required) {
        const query = new URLSearchParams({
          ticket: String(data.ticket || ticket),
          next: String(data.next || next),
        });
        window.location.assign(`/login/link/otp?${query.toString()}`);
        return;
      }
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
        <PasswordInput
          id="link-password" value={form.password}
          onChange={(value) => setForm({ ...form, password: value })}
          autoComplete="current-password" required
        />
      </div>
      <button className="btn btn-primary" style={{ width: "100%", height: 42, marginTop: 10 }}
        disabled={busy}>
        {busy ? "绑定中…" : "绑定并登录"}
      </button>
    </form>
  );
}
