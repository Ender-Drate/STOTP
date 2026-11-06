"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function UserActions({
  userId, role, status, isSelf, stotpBound,
}: {
  userId: number;
  role: "admin" | "user";
  status: "active" | "disabled";
  isSelf: boolean;
  stotpBound: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function unbindStotp() {
    if (!confirm("解绑该用户的 STOTP 设备？解绑后登录不再要求验证码。")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/stotp`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error?.message || "解绑失败");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function update(patch: { role?: string; status?: string }) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error?.message || "操作失败");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row">
      <select
        className="input" style={{ height: 30, width: 96, fontSize: 12 }}
        value={role} disabled={busy || isSelf}
        onChange={(e) => update({ role: e.target.value })}
      >
        <option value="user">普通用户</option>
        <option value="admin">管理员</option>
      </select>
      <select
        className="input" style={{ height: 30, width: 84, fontSize: 12 }}
        value={status} disabled={busy || isSelf}
        onChange={(e) => update({ status: e.target.value })}
      >
        <option value="active">正常</option>
        <option value="disabled">禁用</option>
      </select>
      {stotpBound ? (
        <button type="button" className="btn" style={{ height: 30, fontSize: 12 }}
          onClick={unbindStotp} disabled={busy}>
          解绑 STOTP
        </button>
      ) : null}
    </div>
  );
}
