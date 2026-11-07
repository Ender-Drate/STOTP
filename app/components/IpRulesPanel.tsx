"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { IpRule } from "@/lib/ip-rules";

export function IpRulesPanel({ rules }: { rules: IpRule[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ ip: "", action: "watch", reason: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/ip-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error?.message || "保存失败" });
        return;
      }
      setForm({ ip: "", action: "watch", reason: "" });
      setMsg({ ok: true, text: "IP 规则已保存" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(rule: IpRule) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/ip-rules?id=${rule.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setMsg({ ok: false, text: data?.error?.message || "删除失败" });
        return;
      }
      setMsg({ ok: true, text: "IP 规则已删除" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad">
      <div className="card-title" style={{ marginBottom: 10 }}>IP 观察 / 封禁</div>
      <form className="row" style={{ flexWrap: "wrap", gap: 8 }} onSubmit={save}>
        <input className="input mono" required placeholder="IP 地址" value={form.ip}
          onChange={(e) => setForm({ ...form, ip: e.target.value })} style={{ width: 180 }} />
        <select className="input" value={form.action}
          onChange={(e) => setForm({ ...form, action: e.target.value })} style={{ width: 110 }}>
          <option value="watch">观察</option>
          <option value="block">封禁</option>
        </select>
        <input className="input" placeholder="原因（可选）" value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
        <button className="btn btn-primary btn-sm" disabled={busy}>保存规则</button>
      </form>
      {msg ? <div className={`notice ${msg.ok ? "notice-ok" : "notice-error"}`}>{msg.text}</div> : null}
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="table">
          <thead>
            <tr><th>IP</th><th>动作</th><th>原因</th><th>创建时间</th><th>操作</th></tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td className="mono small">{rule.ip}</td>
                <td><span className={`pill ${rule.action === "block" ? "pill-red" : "pill-amber"}`}>
                  {rule.action === "block" ? "封禁" : "观察"}
                </span></td>
                <td className="small muted">{rule.reason || "-"}</td>
                <td className="mono small">{new Date(rule.created_at).toLocaleString("zh-CN")}</td>
                <td><button className="btn btn-sm btn-danger" onClick={() => remove(rule)}
                  disabled={busy}>删除</button></td>
              </tr>
            ))}
            {rules.length === 0 ? (
              <tr><td colSpan={5} className="muted">暂无 IP 规则</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        封禁只拦截新的登录/OTP/Passkey/第三方登录，不会踢出已有会话。
      </p>
    </div>
  );
}
