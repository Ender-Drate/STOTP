"use client";

import { useEffect, useState } from "react";
import { PasswordInput } from "./PasswordInput";
import { ShapeCaptcha, type CaptchaPoint } from "./ShapeCaptcha";
import { encryptPassword } from "@/lib/password-client";
import { captchaUrl } from "@/lib/captcha-client";

export function ResetPasswordForm({
  token, requiresTotp, requiresCaptcha,
}: {
  token: string;
  requiresTotp: boolean;
  requiresCaptcha: boolean;
}) {
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [captcha, setCaptcha] = useState<{ image: string } | null>(null);
  const [captchaPoint, setCaptchaPoint] = useState<CaptchaPoint | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refreshCaptcha() {
    try {
      const res = await fetch(captchaUrl("reset-password"), { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (data?.image) {
        setCaptcha({ image: data.image });
        setCaptchaPoint(null);
      }
    } catch {
      // 页面保留错误提示
    }
  }

  useEffect(() => {
    if (requiresCaptcha) void refreshCaptcha();
  }, [requiresCaptcha]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (next.length < 10) {
      setError("新密码至少 10 位");
      return;
    }
    if (next !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    if (requiresCaptcha && captcha && !captchaPoint) {
      setError("请先点击图中的图形");
      return;
    }
    setBusy(true);
    try {
      let encrypted;
      try {
        encrypted = await encryptPassword(next);
      } catch {
        setError("当前环境无法加密密码，请使用 HTTPS 访问");
        return;
      }
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          code,
          captchaCode: captchaPoint ? `${captchaPoint.x},${captchaPoint.y}` : "",
          ...encrypted,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message || "重置失败");
        if (data?.captcha_required) await refreshCaptcha();
        return;
      }
      window.location.assign("/login?reset=1");
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
        <label className="label" htmlFor="reset-password">新密码</label>
        <PasswordInput id="reset-password" value={next} onChange={setNext}
          autoComplete="new-password" placeholder="至少 10 位" required />
      </div>
      <div className="field">
        <label className="label" htmlFor="reset-confirm">确认新密码</label>
        <PasswordInput id="reset-confirm" value={confirm} onChange={setConfirm}
          autoComplete="new-password" placeholder="再次输入新密码" required />
      </div>
      {requiresTotp ? (
        <div className="field">
          <label className="label" htmlFor="reset-totp">TOTP 动态码</label>
          <input id="reset-totp" className="input otp-input" inputMode="numeric"
            autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000" required />
        </div>
      ) : null}
      {requiresCaptcha ? (
        <div className="captcha-box">
          <div className="spread" style={{ marginBottom: 6 }}>
            <span className="label" style={{ margin: 0 }}>图形验证码</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={refreshCaptcha}>
              换一张
            </button>
          </div>
          {captcha ? (
            <ShapeCaptcha
              image={captcha.image}
              point={captchaPoint}
              onPick={setCaptchaPoint}
            />
          ) : <span className="small muted">验证码加载中…</span>}
        </div>
      ) : null}
      <button className="btn btn-primary" style={{ width: "100%", height: 42 }} disabled={busy}>
        {busy ? "重置中…" : "设置新密码"}
      </button>
    </form>
  );
}
