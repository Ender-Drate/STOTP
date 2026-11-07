"use client";

import { useState } from "react";

interface Observation {
  id: number;
  ts: string;
  path: string | null;
  userAgent: string | null;
  tlsFingerprint: string | null;
  score: number;
  level: "low" | "medium" | "high" | "critical";
  reasons: string[];
  signals: Record<string, unknown>;
}

interface Detail {
  ip: string;
  location: string;
  windowHours: number;
  count: number;
  observations: Observation[];
}

const LEVEL: Record<string, string> = { low: "低", medium: "中", high: "高", critical: "严重" };

function text(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function IpDetailsButton({ ip }: { ip: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function open() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/risk/ip?ip=${encodeURIComponent(ip)}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message || "读取详情失败");
        return;
      }
      setDetail(data);
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" onClick={open} disabled={busy}>
        {busy ? "读取中…" : "详情"}
      </button>
      {detail ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${ip} 访问详情`}
          onClick={() => setDetail(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,.38)",
            display: "grid", placeItems: "center", padding: 20,
          }}
        >
          <div
            className="card card-pad"
            onClick={(event) => event.stopPropagation()}
            style={{ width: "min(980px, 100%)", maxHeight: "86vh", overflow: "auto" }}
          >
            <div className="spread" style={{ marginBottom: 12 }}>
              <div>
                <div className="card-title">{ip}</div>
                <div className="small muted">
                  {detail.location} · {detail.windowHours}h 内 {detail.count} 条观测
                </div>
              </div>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDetail(null)}>
                关闭
              </button>
            </div>
            {detail.observations.length === 0 ? (
              <p className="muted">该 IP 在当前窗口内没有客户端观测，只有审计记录。</p>
            ) : null}
            <div style={{ display: "grid", gap: 10 }}>
              {detail.observations.map((item) => (
                <div key={item.id} className="card card-pad" style={{ background: "var(--bg-soft, #fafafa)" }}>
                  <div className="spread" style={{ gap: 12, flexWrap: "wrap" }}>
                    <div className="small">
                      <strong>{new Date(item.ts).toLocaleString("zh-CN")}</strong>
                      <span className="muted" style={{ marginLeft: 8 }}>{item.path || "—"}</span>
                    </div>
                    <span className="pill">{LEVEL[item.level] || item.level} · {item.score}</span>
                  </div>
                  <div className="kv" style={{ marginTop: 8 }}>
                    <div className="kv-row"><span className="muted">TLS 指纹</span><span className="mono small">{text(item.tlsFingerprint)}</span></div>
                    <div className="kv-row"><span className="muted">User-Agent</span><span className="small" style={{ maxWidth: 620, wordBreak: "break-all" }}>{text(item.userAgent)}</span></div>
                    <div className="kv-row"><span className="muted">WebGL 渲染器</span><span className="small">{text(item.signals.webglRenderer)}</span></div>
                    <div className="kv-row"><span className="muted">WebGL 厂商</span><span className="small">{text(item.signals.webglVendor)}</span></div>
                    <div className="kv-row"><span className="muted">平台</span><span className="small">{text(item.signals.platform)}</span></div>
                    <div className="kv-row"><span className="muted">语言 / 时区</span><span className="small">{text(item.signals.languages)} · {text(item.signals.timezone)}</span></div>
                    <div className="kv-row"><span className="muted">屏幕 / 窗口</span><span className="small">{text(item.signals.screen)} · {text(item.signals.outerWidth)}×{text(item.signals.outerHeight)}</span></div>
                    <div className="kv-row"><span className="muted">CPU / 内存 / 插件</span><span className="small">{text(item.signals.hardwareConcurrency)} / {text(item.signals.deviceMemory)} / {text(item.signals.plugins)}</span></div>
                    <div className="kv-row"><span className="muted">自动化</span><span className="small">webdriver={text(item.signals.webdriver)} · headless={text(item.signals.headless)} · chrome={text(item.signals.chrome)}</span></div>
                    <div className="kv-row"><span className="muted">风险原因</span><span className="small">{item.reasons.length ? item.reasons.join("；") : "无异常"}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {error ? <span className="small" style={{ color: "var(--danger, #d33)", marginLeft: 6 }}>{error}</span> : null}
    </>
  );
}
