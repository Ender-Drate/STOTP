"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

interface PasskeyItem {
  id: number;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export function PasskeyPanel({ passkeys }: { passkeys: PasskeyItem[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    setMsg(null);
    try {
      const optionsRes = await fetch("/api/settings/passkeys/options", { method: "POST" });
      const options = await optionsRes.json().catch(() => null);
      if (!optionsRes.ok) {
        setMsg({ ok: false, text: options?.error?.message || "无法生成 Passkey 注册参数" });
        return;
      }
      const response = await startRegistration({ optionsJSON: options });
      const res = await fetch("/api/settings/passkeys/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response, name: name || "Passkey" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error?.message || "Passkey 注册失败" });
        return;
      }
      setName("");
      setMsg({ ok: true, text: "Passkey 已添加" });
      router.refresh();
    } catch (error) {
      setMsg({
        ok: false,
        text: error instanceof Error && error.name === "NotAllowedError"
          ? "已取消或超时" : "浏览器不支持或操作失败",
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("删除这个 Passkey？")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/settings/passkeys/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setMsg({ ok: false, text: data?.error?.message || "删除失败" });
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad" style={{ marginTop: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <div className="card-title">Passkey</div>
        <span className={`pill ${passkeys.length ? "pill-green" : ""}`}>
          {passkeys.length ? `${passkeys.length} 个` : "未添加"}
        </span>
      </div>
      <p className="small muted" style={{ margin: "0 0 16px" }}>
        用指纹 / 面容 / 设备 PIN 直接登录，不需要密码。需要 HTTPS 域名（localhost 除外）。
      </p>
      {msg ? (
        <div className={`notice ${msg.ok ? "notice-ok" : "notice-error"}`}>{msg.text}</div>
      ) : null}
      {passkeys.length ? (
        <div className="kv" style={{ marginBottom: 14 }}>
          {passkeys.map((item) => (
            <div className="kv-row" key={item.id}>
              <span>
                {item.name || "Passkey"}
                <span className="muted small" style={{ marginLeft: 8 }}>
                  {new Date(item.createdAt).toLocaleDateString("zh-CN")}
                </span>
              </span>
              <button className="btn btn-sm btn-danger" onClick={() => remove(item.id)}
                disabled={busy}>删除</button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <label className="label" htmlFor="passkey-name">名称（可选）</label>
          <input id="passkey-name" className="input" value={name}
            onChange={(e) => setName(e.target.value)} placeholder="例如：MacBook Touch ID" />
        </div>
        <button className="btn btn-primary" onClick={add} disabled={busy}>
          {busy ? "等待设备…" : "添加 Passkey"}
        </button>
      </div>
    </div>
  );
}
