"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function IpClearRiskButton({ ip }: { ip: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function clear() {
    if (!confirm(`清除 ${ip} 的风险？清除前的观测/失败不再计入，新事件继续累计。`)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/risk/ip/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message || "清除失败");
        return;
      }
      router.refresh();
    } catch {
      setError("网络错误");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <button type="button" className="btn btn-sm btn-ghost" onClick={clear} disabled={busy}>
        {busy ? "清除中…" : "清除风险"}
      </button>
      {error ? <span className="small" style={{ color: "var(--danger, #d33)" }}>{error}</span> : null}
    </span>
  );
}
