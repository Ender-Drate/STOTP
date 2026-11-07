"use client";

import { useState } from "react";

export function LinkOtpForm({ ticket, next }: { ticket: string; next: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/link/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket, code, next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message || "验证失败");
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
        <label className="label" htmlFor="link-otp">动态验证码</label>
        <input id="link-otp" className="input otp-input" inputMode="numeric"
          autoComplete="one-time-code" autoFocus maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000" required />
      </div>
      <p className="small muted" style={{ margin: "4px 0 0" }}>
        打开 TOTP App 查看当前 6 位验证码，30 秒刷新一次。
      </p>
      <button className="btn btn-primary"
        style={{ width: "100%", height: 42, marginTop: 16 }} disabled={busy}>
        {busy ? "验证中…" : "验证并绑定"}
      </button>
    </form>
  );
}
