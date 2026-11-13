"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShapeCaptcha, type CaptchaPoint } from "./ShapeCaptcha";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [captcha, setCaptcha] = useState<{ ticket: string; image: string; prompt: string } | null>(null);
  const [captchaPoint, setCaptchaPoint] = useState<CaptchaPoint | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshCaptcha() {
    try {
      const res = await fetch("/api/auth/captcha?purpose=forgot-password", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (data?.ticket && data?.image) {
        setCaptcha({ ticket: data.ticket, image: data.image, prompt: data.prompt });
        setCaptchaPoint(null);
      }
    } catch {
      // 保留页面
    }
  }

  useEffect(() => { void refreshCaptcha(); }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (captcha && !captchaPoint) {
      setMsg({ ok: false, text: "请先点击图中的图形" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          captchaTicket: captcha?.ticket || "",
          captchaCode: captchaPoint ? `${captchaPoint.x},${captchaPoint.y}` : "",
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
            <span className="label" style={{ margin: 0 }}>图形验证码</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={refreshCaptcha}>
              换一张
            </button>
          </div>
          <ShapeCaptcha
            image={captcha.image}
            prompt={captcha.prompt}
            point={captchaPoint}
            onPick={setCaptchaPoint}
          />
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
