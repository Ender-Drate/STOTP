"use client";

import { useEffect, useState } from "react";

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  hasPassword: boolean;
  source: string;
}

export function SmtpSettingsForm({ defaultTo }: { defaultTo: string }) {
  const [config, setConfig] = useState<SmtpConfig | null>(null);
  const [password, setPassword] = useState("");
  const [to, setTo] = useState(defaultTo);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/admin/smtp", { cache: "no-store" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setMsg({ ok: false, text: data?.error?.message || "读取 SMTP 配置失败" });
      return;
    }
    setConfig(data.config);
  }

  useEffect(() => { void load(); }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!config) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/smtp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, password: password || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error?.message || "保存失败" });
        return;
      }
      setConfig(data.config);
      setPassword("");
      setMsg({ ok: true, text: "SMTP 配置已保存" });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/smtp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error?.message || "测试邮件发送失败" });
        return;
      }
      setMsg({ ok: true, text: `测试邮件已发送（${data.messageId || "queued"}）` });
    } finally {
      setBusy(false);
    }
  }

  if (!config) {
    return <div className="card card-pad">{msg ? msg.text : "加载中…"}</div>;
  }

  return (
    <div className="card card-pad">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="card-title">SMTP 邮件服务</div>
        <span className="pill">{config.source === "database" ? "后台配置" : "环境变量"}</span>
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>
        用于注册邮箱验证和重发验证邮件。密码加密保存在数据库，不会回显。
      </p>
      {msg ? <div className={`notice ${msg.ok ? "notice-ok" : "notice-error"}`}>{msg.text}</div> : null}
      <form onSubmit={save}>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label className="label">SMTP 主机</label>
            <input className="input" value={config.host}
              onChange={(e) => setConfig({ ...config, host: e.target.value })} required />
          </div>
          <div className="field">
            <label className="label">端口</label>
            <input className="input" type="number" value={config.port}
              onChange={(e) => setConfig({ ...config, port: Number(e.target.value) })} required />
          </div>
          <div className="field">
            <label className="label">用户名</label>
            <input className="input" value={config.user}
              onChange={(e) => setConfig({ ...config, user: e.target.value })} required />
          </div>
          <div className="field">
            <label className="label">密码</label>
            <input className="input" type="password" autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={config.hasPassword ? "已保存，留空不修改" : "输入 SMTP 密码"} />
          </div>
          <div className="field">
            <label className="label">发件人</label>
            <input className="input" value={config.from}
              onChange={(e) => setConfig({ ...config, from: e.target.value })} required />
          </div>
          <div className="field">
            <label className="label">加密</label>
            <label className="row" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={config.secure}
                onChange={(e) => setConfig({ ...config, secure: e.target.checked })} />
              SSL/TLS（465 端口通常开启）
            </label>
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>{busy ? "保存中…" : "保存 SMTP"}</button>
        </div>
      </form>
      <div className="divider" />
      <div className="field" style={{ maxWidth: 420 }}>
        <label className="label">测试收件人</label>
        <input className="input" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <button type="button" className="btn btn-ghost" onClick={test} disabled={busy || !config.hasPassword}>
        {busy ? "发送中…" : "发送测试邮件"}
      </button>
    </div>
  );
}
