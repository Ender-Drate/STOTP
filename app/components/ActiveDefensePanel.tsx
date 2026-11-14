"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface DefenseView {
  ip: string;
  action: "throttle" | "block" | string;
  reason: string;
  level: string;
  score: number;
  remaining: number;
}

function remainingText(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

export function ActiveDefensePanel({
  initialEnabled, initialDefenses,
}: {
  initialEnabled: boolean;
  initialDefenses: DefenseView[];
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [defenses, setDefenses] = useState(initialDefenses);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/risk/defense", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message || "操作失败");
        return;
      }
      setEnabled(Boolean(data?.enabled));
      setDefenses(Array.isArray(data?.defenses) ? data.defenses : []);
      router.refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function clear(ip: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/risk/defense?ip=${encodeURIComponent(ip)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message || "操作失败");
        return;
      }
      setDefenses((prev) => prev.filter((item) => item.ip !== ip));
      router.refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad">
      <div className="spread" style={{ gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="card-title">主动防护</div>
          <div className="muted small" style={{ marginTop: 4 }}>
            开启后对高风险 IP 自动限流或临时封禁，最长 15 分钟。
          </div>
        </div>
        <button
          type="button"
          className={`btn ${enabled ? "btn-danger" : "btn-primary"}`}
          onClick={toggle}
          disabled={busy}
        >
          {enabled ? "关闭主动防护" : "开启主动防护"}
        </button>
      </div>

      {error ? <div className="notice notice-error" style={{ marginTop: 10 }}>{error}</div> : null}

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="table">
          <thead>
            <tr>
              <th>IP</th>
              <th>动作</th>
              <th>等级</th>
              <th>原因</th>
              <th>剩余</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {defenses.map((item) => (
              <tr key={item.ip}>
                <td className="mono small">{item.ip}</td>
                <td>
                  <span className={`pill ${item.action === "block" ? "pill-red" : "pill-amber"}`}>
                    {item.action === "block" ? "封禁" : "限流"}
                  </span>
                </td>
                <td className="small">{item.level}</td>
                <td className="small muted" style={{ maxWidth: 320 }}>{item.reason}</td>
                <td className="mono small">{remainingText(item.remaining)}</td>
                <td>
                  <button type="button" className="btn btn-sm btn-ghost"
                    onClick={() => clear(item.ip)} disabled={busy}>
                    解除
                  </button>
                </td>
              </tr>
            ))}
            {defenses.length === 0 ? (
              <tr><td colSpan={6} className="muted small">暂无主动防护记录</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
