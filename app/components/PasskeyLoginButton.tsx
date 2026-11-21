"use client";

import { useEffect, useRef, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { passkeyErrorText, passkeySupportError } from "@/lib/passkey-client";

export function PasskeyLoginButton({
  next, autoStart = false,
}: {
  next: string;
  autoStart?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempted = useRef(false);

  async function login() {
    const unsupported = passkeySupportError();
    if (unsupported) {
      setError(unsupported);
      return;
    }
    setBusy(true);
    setError("");
    try {
      // 硬件安全密钥通常不是 discoverable credential，需要用户名来限定
      // allowCredentials；平台 Passkey 可以留空走 discoverable 流程。
      const username = (document.querySelector<HTMLInputElement>("#identifier")?.value || "").trim();
      const optionsRes = await fetch("/api/auth/passkey/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
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
      setError(passkeyErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoStart || attempted.current) return;
    attempted.current = true;
    void login();
    // Auto-start only once; login is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  return (
    <div style={{ marginTop: 14 }}>
      {error ? <div className="auth-error">{error}</div> : null}
      <button type="button" className="btn btn-ghost" style={{ width: "100%", height: 42 }}
        onClick={login} disabled={busy}>
        {busy ? "等待设备…" : autoStart ? "使用 Passkey 继续" : "使用 Passkey 登录"}
      </button>
      <p className="small muted" style={{ margin: "6px 0 0", textAlign: "center" }}>
        硬件安全密钥请先填写上方用户名或邮箱；平台 Passkey 可留空。
      </p>
    </div>
  );
}
