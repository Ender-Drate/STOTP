"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Binding {
  clientId: string;
  accountId: string | null;
  status: string;
  createdAt: string;
  lastVerifiedAt: string | null;
}

export function StotpPanel({ binding, enabled }: {
  binding: Binding | null;
  enabled: boolean;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(binding?.clientId || "");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function bind(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/stotp/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error?.message || "绑定失败" });
        return;
      }
      setCode("");
      setMsg({ ok: true, text: "STOTP 设备已绑定" });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "网络错误，请重试" });
    } finally {
      setBusy(false);
    }
  }

  async function unbind() {
    if (!confirm("解绑后登录将不再需要 STOTP 验证码，确定吗？")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/stotp/unbind", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error?.message || "解绑失败" });
        return;
      }
      setClientId("");
      setMsg({ ok: true, text: "已解绑 STOTP 设备" });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "网络错误，请重试" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad" style={{ marginTop: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <div className="card-title">STOTP 两步验证</div>
        <span className={`pill ${binding ? "pill-green" : ""}`}>
          {binding ? "已绑定" : "未绑定"}
        </span>
      </div>
      <p className="small muted" style={{ margin: "0 0 16px" }}>
        绑定后登录需要密码 + STOTP App 的 6 位验证码；这是可选项，未绑定时仍可密码登录。
      </p>
      {msg ? (
        <div className={`notice ${msg.ok ? "notice-ok" : "notice-error"}`}>{msg.text}</div>
      ) : null}
      {!enabled ? (
        <div className="notice notice-error">
          STOTP 未配置或已关闭，暂时不能绑定。请联系管理员设置 STOTP_BASE_URL 和登录站凭证。
        </div>
      ) : binding ? (
        <>
          <div className="kv">
            <div className="kv-row"><span>设备 client_id</span><span className="mono small">{binding.clientId}</span></div>
            <div className="kv-row"><span>绑定时间</span><span className="small">{new Date(binding.createdAt).toLocaleString("zh-CN")}</span></div>
            <div className="kv-row"><span>最近验证</span><span className="small">{binding.lastVerifiedAt ? new Date(binding.lastVerifiedAt).toLocaleString("zh-CN") : "—"}</span></div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-danger" onClick={unbind} disabled={busy}>
              {busy ? "处理中…" : "解绑 STOTP"}
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={bind}>
          <div className="field">
            <label className="label" htmlFor="stotp-client">设备 client_id</label>
            <input id="stotp-client" className="input mono" value={clientId}
              onChange={(e) => setClientId(e.target.value.trim())}
              placeholder="在 STOTP App 设备详情中复制 UUID" required />
          </div>
          <div className="field">
            <label className="label" htmlFor="stotp-code">当前 6 位验证码</label>
            <input id="stotp-code" className="input otp-input" inputMode="numeric"
              autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000" required />
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "验证中…" : "绑定设备"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
