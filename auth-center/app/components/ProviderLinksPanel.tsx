"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface LinkItem {
  providerId: number;
  name: string;
  iconUrl: string | null;
  subject: string;
  createdAt: string;
}

export function ProviderLinksPanel({ links }: { links: LinkItem[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function unlink(item: LinkItem) {
    if (!confirm(`解绑「${item.name}」？解绑后该第三方账户需要重新绑定本地账户。`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/settings/links/${item.providerId}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error?.message || "解绑失败" });
        return;
      }
      setMsg({ ok: true, text: "已解绑第三方账户" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad" style={{ marginTop: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <div className="card-title">第三方登录绑定</div>
        <span className={`pill ${links.length ? "pill-green" : ""}`}>
          {links.length ? `${links.length} 个` : "未绑定"}
        </span>
      </div>
      <p className="small muted" style={{ margin: "0 0 16px" }}>
        第三方账户首次登录需要本地账户确认；绑定后可解绑，解绑后需重新绑定。
      </p>
      {msg ? (
        <div className={`notice ${msg.ok ? "notice-ok" : "notice-error"}`}>{msg.text}</div>
      ) : null}
      {links.length === 0 ? (
        <div className="muted small">暂无第三方登录绑定</div>
      ) : (
        <div className="kv">
          {links.map((item) => (
            <div className="kv-row" key={item.providerId}>
              <span className="row" style={{ gap: 8 }}>
                <span className="provider-icon">
                  {item.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.iconUrl} alt="" />
                  ) : item.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <span style={{ display: "block" }}>{item.name}</span>
                  <span className="muted small mono">{item.subject}</span>
                </span>
              </span>
              <button className="btn btn-sm btn-danger" onClick={() => unlink(item)}
                disabled={busy}>解绑</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
