"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface RoleOption {
  id: number;
  name: string;
  key: string;
}

export function UserActions({
  userId, roleId, status, isSelf,
  roles, canAssignRoles, canDisable,
}: {
  userId: number;
  roleId: number;
  status: "active" | "disabled";
  isSelf: boolean;
  roles: RoleOption[];
  canAssignRoles: boolean;
  canDisable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function update(patch: { roleId?: number; status?: string }) {
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
    <div className="row" style={{ flexWrap: "wrap" }}>
      <select
        className="input" style={{ height: 30, width: 150, fontSize: 12 }}
        value={roleId} disabled={busy || isSelf || !canAssignRoles}
        onChange={(e) => update({ roleId: Number(e.target.value) })}
        title={canAssignRoles ? "设置权限等级" : "只有最高管理员可以设置权限等级"}
      >
        {roles.map((role) => (
          <option key={role.id} value={role.id}>{role.name}</option>
        ))}
      </select>
      <select
        className="input" style={{ height: 30, width: 84, fontSize: 12 }}
        value={status} disabled={busy || isSelf || !canDisable}
        onChange={(e) => update({ status: e.target.value })}
      >
        <option value="active">正常</option>
        <option value="disabled">禁用</option>
      </select>
    </div>
  );
}
