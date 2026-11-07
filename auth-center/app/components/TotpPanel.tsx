"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface SetupData {
  secret: string;
  otpauth: string;
  qr: string;
}

export function TotpPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function startSetup() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/totp/setup", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error?.message || "无法生成 TOTP" });
        return;
      }
      setSetup(data);
    } finally {
      setBusy(false);
    }
  }

  async function enable(event: React.FormEvent) {
    event.preventDefault();
    if (!setup) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/totp/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: setup.secret, code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error?.message || "验证失败" });
        return;
      }
      setSetup(null);
      setCode("");
      setMsg({ ok: true, text: "TOTP 已启用，下次登录需要输入验证码" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function disable(event: React.FormEvent) {
    event.preventDefault();
    if (!confirm("关闭 TOTP 后登录将不再需要验证码，确定吗？")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/totp/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error?.message || "关闭失败" });
        return;
      }
      setPassword("");
      setMsg({ ok: true, text: "TOTP 已关闭" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad" style={{ marginTop: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <div className="card-title">TOTP 两步验证</div>
        <span className={`pill ${enabled ? "pill-green" : ""}`}>
          {enabled ? "已启用" : "未启用"}
        </span>
      </div>
      <p className="small muted" style={{ margin: "0 0 16px" }}>
        使用任意 TOTP App（1Password、Google Authenticator、Aegis 等）扫描二维码。
        启用后登录需要密码 + 6 位动态验证码。
      </p>
      {msg ? (
        <div className={`notice ${msg.ok ? "notice-ok" : "notice-error"}`}>{msg.text}</div>
      ) : null}

      {enabled ? (
        <form onSubmit={disable} style={{ maxWidth: 360 }}>
          <div className="field">
            <label className="label" htmlFor="totp-password">当前密码</label>
            <input id="totp-password" className="input" type="password"
              autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="form-actions">
            <button className="btn btn-danger" disabled={busy}>
              {busy ? "处理中…" : "关闭 TOTP"}
            </button>
          </div>
        </form>
      ) : setup ? (
        <form onSubmit={enable}>
          <div className="totp-setup">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="TOTP 二维码" width={180} height={180} />
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="label">手动输入密钥</div>
              <div className="mono" style={{ wordBreak: "break-all", margin: "4px 0 12px" }}>
                {setup.secret}
              </div>
              <div className="field">
                <label className="label" htmlFor="totp-code">App 中的 6 位验证码</label>
                <input id="totp-code" className="input otp-input" inputMode="numeric"
                  autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000" required autoFocus />
              </div>
              <div className="btn-row">
                <button className="btn btn-primary" disabled={busy}>
                  {busy ? "验证中…" : "启用 TOTP"}
                </button>
                <button type="button" className="btn btn-ghost"
                  onClick={() => { setSetup(null); setCode(""); }}>取消</button>
              </div>
            </div>
          </div>
        </form>
      ) : (
        <button className="btn btn-primary" onClick={startSetup} disabled={busy}>
          {busy ? "生成中…" : "启用 TOTP"}
        </button>
      )}
    </div>
  );
}
