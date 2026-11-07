"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RiskSettings } from "@/lib/risk";
import { Alert, Notification } from "./Feedback";

export function RiskSettingsForm({ initial }: { initial: RiskSettings }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function update(key: keyof RiskSettings, value: string) {
    setForm((prev) => ({ ...prev, [key]: Number(value) }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/risk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error?.message || "保存失败" });
        return;
      }
      setForm(data.settings);
      setMsg({ ok: true, text: "风控指标已保存" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card card-pad" onSubmit={save}>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div>
          <div className="card-title">风控指标</div>
          <div className="small muted" style={{ marginTop: 3 }}>仅最高管理员可修改</div>
        </div>
        <button className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </button>
      </div>
      {msg ? (
        msg.ok ? (
          <Notification kind="success" title="已保存">{msg.text}</Notification>
        ) : (
          <Alert kind="error" title="保存失败">{msg.text}</Alert>
        )
      ) : null}
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field">
          <label className="label">失败多少次后要求图形验证码</label>
          <input className="input" type="number" min={1} max={20} value={form.captchaAfterFailures}
            onChange={(e) => update("captchaAfterFailures", e.target.value)} />
        </div>
        <div className="field">
          <label className="label">失败计数窗口（秒）</label>
          <input className="input" type="number" min={60} max={86400} value={form.loginFailWindowSeconds}
            onChange={(e) => update("loginFailWindowSeconds", e.target.value)} />
        </div>
        <div className="field">
          <label className="label">高风险阈值</label>
          <input className="input" type="number" min={1} max={100} value={form.riskHighThreshold}
            onChange={(e) => update("riskHighThreshold", e.target.value)} />
        </div>
        <div className="field">
          <label className="label">严重风险阈值</label>
          <input className="input" type="number" min={1} max={100} value={form.riskCriticalThreshold}
            onChange={(e) => update("riskCriticalThreshold", e.target.value)} />
        </div>
        <div className="field">
          <label className="label">审计保留天数</label>
          <input className="input" type="number" min={1} max={3650} value={form.auditRetentionDays}
            onChange={(e) => update("auditRetentionDays", e.target.value)} />
        </div>
      </div>
    </form>
  );
}
