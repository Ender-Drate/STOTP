"use client";

import { useState } from "react";

function errorOf(payload: unknown, fallback: string): string {
  const data = payload as { error?: { message?: string } } | null;
  return data?.error?.message || fallback;
}

export function LoginForm({ next, initialError = "" }: {
  next: string;
  initialError?: string;
}) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: identifier, password, remember, next }),
      });
      const data = await res.json().catch(() => null);
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
        <input
          id="password" name="password" className="input" type="password"
          autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="密码" required
        />
      </div>
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

export function RegisterForm({ next = "/dashboard", initialError = "" }: {
  next?: string;
  initialError?: string;
}) {
  const [form, setForm] = useState({
    displayName: "", username: "", email: "", password: "", confirm: "",
  });
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.username,
          email: form.email,
          password: form.password,
          displayName: form.displayName,
          next,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorOf(data, "注册失败"));
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
        <input id="newPassword" name="password" className="input" type="password"
          value={form.password} autoComplete="new-password"
          onChange={(e) => update("password", e.target.value)}
          placeholder="至少 8 位" required />
      </div>
      <div className="field">
        <label className="label" htmlFor="confirmPassword">确认密码</label>
        <input id="confirmPassword" name="confirm" className="input" type="password"
          value={form.confirm} autoComplete="new-password"
          onChange={(e) => update("confirm", e.target.value)} placeholder="再次输入密码" required />
      </div>
      <button type="submit" className="btn btn-primary"
        style={{ width: "100%", height: 42, marginTop: 10 }} disabled={busy}>
        {busy ? "创建中…" : "创建账号"}
      </button>
    </form>
  );
}
