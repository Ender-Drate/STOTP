"use client";

import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";

export function PasskeyLoginButton({ next }: { next: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function login() {
    setBusy(true);
    setError("");
    try {
      const optionsRes = await fetch("/api/auth/passkey/options", { method: "POST" });
      const options = await optionsRes.json().catch(() => null);
      if (!optionsRes.ok) {
        setError(options?.error?.message || "无法发起 Passkey 登录");
        return;
      }
      const response = await startAuthentication({ optionsJSON: options });
      const res = await fetch("/api/auth/passkey/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response, next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message || "Passkey 登录失败");
        return;
      }
      window.location.assign(data?.next || next || "/dashboard");
    } catch (err) {
      setError(err instanceof Error && err.name === "NotAllowedError"
        ? "已取消或超时" : "浏览器不支持或操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 14 }}>
      {error ? <div className="auth-error">{error}</div> : null}
      <button type="button" className="btn btn-ghost" style={{ width: "100%", height: 42 }}
        onClick={login} disabled={busy}>
        {busy ? "等待设备…" : "使用 Passkey 登录"}
      </button>
    </div>
  );
}
