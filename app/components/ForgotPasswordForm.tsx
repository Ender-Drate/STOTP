"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [captcha, setCaptcha] = useState<{ ticket: string; image: string } | null>(null);
  const [captchaCode, setCaptchaCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshCaptcha() {
    try {
      const res = await fetch("/api/auth/captcha", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (data?.ticket && data?.image) {
        setCaptcha({ ticket: data.ticket, image: data.image });
        setCaptchaCode("");
      }
    } catch {
      // 保留页面
    }
  }

  useEffect(() => { void refreshCaptcha(); }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          captchaTicket: captcha?.ticket || "",
          captchaCode,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (data?.captcha_required) await refreshCaptcha();
        setMsg({ ok: false, text: data?.error?.message || "发送失败，请稍后重试" });
        return;
      }
      setMsg({ ok: true, text: data?.message || "如果该邮箱已注册，重置邮件已发送" });
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
        <label className="label" htmlFor="forgot-email">注册邮箱</label>
        <input id="forgot-email" className="input" type="email" value={email}
          autoComplete="email" placeholder="you@example.com" required
          onChange={(e) => setEmail(e.target.value)} />
      </div>
      {captcha ? (
        <div className="captcha-box">
          <div className="spread" style={{ marginBottom: 6 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={captcha.image} alt="图形验证码" width={160} height={52} />
            <button type="button" className="btn btn-sm btn-ghost" onClick={refreshCaptcha}>
              换一张
            </button>
          </div>
          <label className="label" htmlFor="forgot-captcha">图形验证码</label>
          <input id="forgot-captcha" className="input mono" value={captchaCode}
            autoComplete="off" placeholder="输入图中字符" required
            onChange={(e) => setCaptchaCode(e.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 5))} />
        </div>
      ) : null}
      <button className="btn btn-primary" style={{ width: "100%", height: 42, marginTop: 8 }} disabled={busy}>
        {busy ? "发送中…" : "发送重置邮件"}
      </button>
      <div className="auth-foot">
        <Link href="/login">返回登录</Link>
        <span className="auth-foot-sep">·</span>
        <Link href="/register">注册账号</Link>
      </div>
    </form>
  );
}
