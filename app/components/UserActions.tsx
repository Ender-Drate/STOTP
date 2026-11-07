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
  roles, canAssignRoles, canDisable, canDelete,
}: {
  userId: number;
  roleId: number;
  status: "active" | "disabled" | "pending";
  isSelf: boolean;
  roles: RoleOption[];
  canAssignRoles: boolean;
  canDisable: boolean;
  canDelete: boolean;
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

  async function remove() {
    if (!confirm("删除该用户？其会话、令牌、Passkey、第三方绑定都会被删除。")) return;
    if (!confirm("再次确认：删除后不可恢复，确定删除？")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error?.message || "删除失败");
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
        {status === "pending" ? <option value="pending" disabled>待验证</option> : null}
      </select>
      {canDelete && !isSelf ? (
        <button type="button" className="btn btn-sm btn-danger"
          onClick={remove} disabled={busy}>
          删除用户
        </button>
      ) : null}
    </div>
  );
}
