"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface SessionView {
  id: string;
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
}

function deviceName(ua: string | null): string {
  if (!ua) return "未知设备";
  if (/iphone|ipad|ios/i.test(ua)) return "iOS 设备";
  if (/android/i.test(ua)) return "Android 设备";
  if (/windows/i.test(ua)) return "Windows";
  if (/macintosh|mac os/i.test(ua)) return "macOS";
  if (/linux/i.test(ua)) return "Linux";
  return "浏览器";
}

function browserName(ua: string | null): string {
  if (!ua) return "";
  if (/edg\//i.test(ua)) return "Edge";
  if (/chrome\//i.test(ua) && !/chromium/i.test(ua)) return "Chrome";
  if (/firefox\//i.test(ua)) return "Firefox";
  if (/safari\//i.test(ua) && !/chrome/i.test(ua)) return "Safari";
  return "";
}

export function SessionsPanel({ sessions }: { sessions: SessionView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function revoke(session: SessionView) {
    if (!confirm(session.current
      ? "退出当前设备？需要重新登录。"
      : "撤销这个登录会话？")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/settings/sessions/${session.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error?.message || "撤销失败" });
        return;
      }
      if (data?.current) {
        window.location.assign("/login");
        return;
      }
      setMsg({ ok: true, text: "会话已撤销" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function revokeOthers() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/sessions", { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error?.message || "操作失败" });
        return;
      }
      setMsg({ ok: true, text: `已退出 ${data?.count ?? 0} 个其他设备` });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad" style={{ marginTop: 16 }}>
      <div className="spread" style={{ marginBottom: 10 }}>
        <div className="card-title">登录设备 <span className="pill">{sessions.length}</span></div>
        <button className="btn btn-sm btn-ghost" onClick={revokeOthers} disabled={busy}>
          退出其他设备
        </button>
      </div>
      <p className="small muted" style={{ margin: "0 0 14px" }}>
        这里显示当前账号的有效会话。撤销后该设备需要重新登录。
      </p>
      {msg ? <div className={`notice ${msg.ok ? "notice-ok" : "notice-error"}`}>{msg.text}</div> : null}
      <div className="kv session-list">
        {sessions.map((session) => (
          <div className="kv-row" key={session.id}>
            <span style={{ minWidth: 0 }}>
              <span className="row" style={{ gap: 7 }}>
                <span style={{ fontWeight: 600 }}>{deviceName(session.userAgent)}</span>
                {browserName(session.userAgent) ? (
                  <span className="muted small">{browserName(session.userAgent)}</span>
                ) : null}
                {session.current ? <span className="pill pill-green">当前</span> : null}
              </span>
              <span className="small muted" style={{ display: "block", marginTop: 3 }}>
                {session.ip || "IP 未知"} · 最近活动{" "}
                {session.lastSeenAt ? new Date(session.lastSeenAt).toLocaleString("zh-CN") : "未知"}
              </span>
            </span>
            <button className={`btn btn-sm ${session.current ? "btn-ghost" : "btn-danger"}`}
              onClick={() => revoke(session)} disabled={busy}>
              {session.current ? "退出" : "撤销"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
