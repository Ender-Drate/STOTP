"use client";

import { useEffect, useState } from "react";
import { PasswordInput } from "./PasswordInput";
import { ShapeCaptcha, type CaptchaPoint } from "./ShapeCaptcha";
import { encryptPassword } from "@/lib/password-client";
import { captchaUrl } from "@/lib/captcha-client";

function errorOf(payload: unknown, fallback: string): string {
  const data = payload as { error?: { message?: string } } | null;
  return data?.error?.message || fallback;
}

export function LoginForm({ next, initialError = "", verified = false }: {
  next: string;
  initialError?: string;
  verified?: boolean;
}) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<{ image: string } | null>(null);
  const [captchaPoint, setCaptchaPoint] = useState<CaptchaPoint | null>(null);

  async function refreshCaptcha() {
    try {
      const res = await fetch(captchaUrl("login"), { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (data?.image) {
        setCaptcha({ image: data.image });
        setCaptchaPoint(null);
      }
    } catch {
      // 图形验证码加载失败时保留原错误提示
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (captcha && !captchaPoint) {
      setError("请先点击图中的图形");
      return;
    }
    setBusy(true);
    try {
      let encrypted;
      try {
        encrypted = await encryptPassword(password);
      } catch {
        setError("当前环境无法加密密码，请使用 HTTPS 访问");
        return;
      }
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: identifier, remember, next,
          captchaCode: captchaPoint ? `${captchaPoint.x},${captchaPoint.y}` : "",
          ...encrypted,
        }),
      });
      const data = await res.json().catch(() => null);
      if (data?.otp_required && data?.ticket) {
        const query = new URLSearchParams({ ticket: String(data.ticket), next });
        window.location.assign(`/login/otp?${query.toString()}`);
        return;
      }
      if (data?.captcha_required) {
        await refreshCaptcha();
        setError(errorOf(data, "请输入图形验证码"));
        return;
      }
      if (!res.ok) {
        setError(errorOf(data, "登录失败"));
        return;
      }
      window.location.assign(next || "/dashboard");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form method="post" action="/api/auth/login" onSubmit={submit}>
      <input type="hidden" name="next" value={next} />
      {verified ? <div className="notice notice-ok">邮箱已验证，请登录。</div> : null}
      {error ? <div className="auth-error">{error}</div> : null}
      <div className="field">
        <label className="label" htmlFor="identifier">用户名或邮箱</label>
        <input
          id="identifier" name="username" className="input" autoComplete="username" autoFocus
          value={identifier} onChange={(e) => setIdentifier(e.target.value)}
          placeholder="用户名或邮箱" required
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="password">密码</label>
        <PasswordInput
          id="password" name="password" value={password} onChange={setPassword}
          autoComplete="current-password" placeholder="密码" required
        />
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
            point={captchaPoint}
            onPick={setCaptchaPoint}
          />
        </div>
      ) : null}
      <label className="row" style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>
        <input type="checkbox" name="remember" value="1" checked={remember}
          onChange={(e) => setRemember(e.target.checked)} />
        30 天内自动登录
      </label>
      <button type="submit" className="btn btn-primary"
        style={{ width: "100%", height: 42, marginTop: 10 }} disabled={busy}>
        {busy ? "登录中…" : "登录"}
      </button>
    </form>
  );
}

export function OtpForm({ ticket, next, initialError = "" }: {
  ticket: string;
  next: string;
  initialError?: string;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket, code, next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorOf(data, "验证失败"));
        return;
      }
      window.location.assign(next || "/dashboard");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form method="post" action="/api/auth/login/otp" onSubmit={submit}>
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="next" value={next} />
      {error ? <div className="auth-error">{error}</div> : null}
      <div className="field">
        <label className="label" htmlFor="otp">动态验证码</label>
        <input
          id="otp" name="code" className="input otp-input" inputMode="numeric"
          autoComplete="one-time-code" autoFocus maxLength={6} pattern="[0-9]{6}"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000" required
        />
      </div>
      <p className="small muted" style={{ margin: "4px 0 0" }}>
        打开 TOTP App 查看当前 6 位验证码，30 秒刷新一次。
      </p>
      <button type="submit" className="btn btn-primary"
        style={{ width: "100%", height: 42, marginTop: 16 }} disabled={busy}>
        {busy ? "验证中…" : "验证并登录"}
      </button>
    </form>
  );
}

export function RegisterForm({ next = "/dashboard", initialError = "" }: {
  next?: string;
  initialError?: string;
}) {  const [form, setForm] = useState({
    displayName: "", username: "", email: "", password: "", confirm: "",
  });
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<{ image: string } | null>(null);
  const [captchaPoint, setCaptchaPoint] = useState<CaptchaPoint | null>(null);

  async function refreshCaptcha() {
    try {
      const res = await fetch(captchaUrl("register"), { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (data?.image) {
        setCaptcha({ image: data.image });
        setCaptchaPoint(null);
      }
    } catch {
      // 验证码加载失败时保留页面
    }
  }

  useEffect(() => {
    void refreshCaptcha();
  }, []);

  function update(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (form.password !== form.confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    if (captcha && !captchaPoint) {
      setError("请先点击图中的图形");
      return;
    }
    setBusy(true);
    try {
      let encrypted;
      try {
        encrypted = await encryptPassword(form.password);
      } catch {
        setError("当前环境无法加密密码，请使用 HTTPS 访问");
        return;
      }
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.username,
          email: form.email,
          displayName: form.displayName,
          next,
          captchaCode: captchaPoint ? `${captchaPoint.x},${captchaPoint.y}` : "",
          ...encrypted,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (data?.captcha_required) await refreshCaptcha();
        setError(errorOf(data, "注册失败"));
        return;
      }
      if (data?.pending) {
        const query = new URLSearchParams({ email: form.email, next });
        if (data.mailSent === false) query.set("mail", "failed");
        window.location.assign(`/register/pending?${query.toString()}`);
        return;
      }
      window.location.assign(next || "/dashboard");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form method="post" action="/api/auth/register" onSubmit={submit}>
      <input type="hidden" name="next" value={next} />
      {error ? <div className="auth-error">{error}</div> : null}
      <div className="field">
        <label className="label" htmlFor="displayName">昵称</label>
        <input id="displayName" name="displayName" className="input" value={form.displayName}
          onChange={(e) => update("displayName", e.target.value)} placeholder="显示名称" />
      </div>
      <div className="field">
        <label className="label" htmlFor="username">用户名</label>
        <input id="username" name="username" className="input" value={form.username}
          autoComplete="username"
          onChange={(e) => update("username", e.target.value)}
          placeholder="3-32 位字母、数字、下划线或点" required />
      </div>
      <div className="field">
        <label className="label" htmlFor="email">邮箱</label>
        <input id="email" name="email" className="input" type="email" value={form.email}
          autoComplete="email"
          onChange={(e) => update("email", e.target.value)} placeholder="you@example.com" required />
      </div>
      <div className="field">
        <label className="label" htmlFor="newPassword">密码</label>
        <PasswordInput
          id="newPassword" name="password" value={form.password}
          onChange={(value) => update("password", value)} autoComplete="new-password"
          placeholder="至少 10 位" required
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="confirmPassword">确认密码</label>
        <PasswordInput
          id="confirmPassword" name="confirm" value={form.confirm}
          onChange={(value) => update("confirm", value)} autoComplete="new-password"
          placeholder="再次输入密码" required
        />
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
            point={captchaPoint}
            onPick={setCaptchaPoint}
          />
        </div>
      ) : null}
      <button type="submit" className="btn btn-primary"
        style={{ width: "100%", height: 42, marginTop: 10 }} disabled={busy}>
        {busy ? "创建中…" : "创建账号"}
      </button>
    </form>
  );
}
