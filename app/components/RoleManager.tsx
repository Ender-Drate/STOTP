"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PERMISSION_DEFS, PERMISSION_GROUPS } from "@/lib/permission-defs";
import { uiText } from "@/lib/ui-i18n";

interface RoleView {
  id: number;
  key: string;
  name: string;
  description: string | null;
  permissionsList: string[];
  is_system: number;
  userCount: number;
  created_at: string;
}

interface Draft {
  id: number | null;
  name: string;
  description: string;
  permissions: string[];
}

const emptyDraft: Draft = { id: null, name: "", description: "", permissions: [] };

export function RoleManager({ roles }: { roles: RoleView[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function startCreate() {
    setMsg(null);
    setDraft({ ...emptyDraft });
  }

  function startEdit(role: RoleView) {
    setMsg(null);
    setDraft({
      id: role.id,
      name: role.name,
      description: role.description || "",
      permissions: [...role.permissionsList],
    });
  }

  function toggle(permission: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      const exists = prev.permissions.includes(permission);
      return {
        ...prev,
        permissions: exists
          ? prev.permissions.filter((item) => item !== permission)
          : [...prev.permissions, permission],
      };
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(
        draft.id ? `/api/admin/roles/${draft.id}` : "/api/admin/roles",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.name,
            description: draft.description,
            permissions: draft.permissions,
          }),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error?.message || "保存失败" });
        return;
      }
      setDraft(null);
      setMsg({ ok: true, text: "权限等级已保存" });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "网络错误，请重试" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(role: RoleView) {
    if (!confirm(uiText(`删除权限等级「${role.name}」？`))) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/roles/${role.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error?.message || "删除失败" });
        return;
      }
      setMsg({ ok: true, text: "权限等级已删除" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">权限</h1>
          <p className="page-desc">创建权限等级，并选择它拥有的权限节点</p>
        </div>
        <button className="btn btn-primary" onClick={startCreate}>新建权限等级</button>
      </div>

      {msg ? (
        <div className={`notice ${msg.ok ? "notice-ok" : "notice-error"}`}>{msg.text}</div>
      ) : null}

      {draft ? (
        <form className="card card-pad" onSubmit={save} style={{ marginBottom: 16 }}>
          <div className="spread" style={{ marginBottom: 14 }}>
            <div className="card-title">{draft.id ? "编辑权限等级" : "新建权限等级"}</div>
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => setDraft(null)}>取消</button>
          </div>
          <div className="grid grid-2" style={{ gap: 14 }}>
            <div className="field">
              <label className="label" htmlFor="role-name">名称</label>
              <input id="role-name" className="input" value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="例如：应用管理员" required />
            </div>
            <div className="field">
              <label className="label" htmlFor="role-desc">说明（可选）</label>
              <input id="role-desc" className="input" value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="这个等级能做什么" />
            </div>
          </div>
          <div className="label" style={{ margin: "4px 0 10px" }}>权限节点</div>
          <div className="perm-groups">
            {PERMISSION_GROUPS.map((group) => (
              <div className="perm-group" key={group}>
                <div className="perm-group-title">{group}</div>
                <div className="perm-grid">
                  {PERMISSION_DEFS.filter((item) => item.group === group).map((item) => (
                    <label className="perm-option" key={item.key}>
                      <input type="checkbox"
                        checked={draft.permissions.includes(item.key)}
                        onChange={() => toggle(item.key)} />
                      <span>
                        <span className="perm-label">{item.label}</span>
                        <span className="perm-key mono">{item.key}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy || !draft.permissions.length}>
              {busy ? "保存中…" : "保存权限等级"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="role-grid">
        {roles.map((role) => (
          <div className="card card-pad role-card" key={role.id}>
            <div className="spread" style={{ alignItems: "flex-start" }}>
              <div>
                <div className="row" style={{ gap: 8 }}>
                  <div className="card-title">{role.name}</div>
                  {role.key === "superadmin" ? <span className="pill pill-blue">最高</span> : null}
                  {role.is_system ? <span className="pill">系统</span> : null}
                </div>
                <div className="muted small" style={{ marginTop: 4 }}>
                  {role.description || "未填写说明"}
                </div>
              </div>
              <span className="pill">{role.userCount} 人</span>
            </div>
            <div className="pills" style={{ marginTop: 12 }}>
              {role.permissionsList.length === 0 ? (
                <span className="muted small">无权限节点</span>
              ) : role.permissionsList.map((permission) => (
                <span className="pill" key={permission} title={permission}>
                  {PERMISSION_DEFS.find((item) => item.key === permission)?.label || permission}
                </span>
              ))}
            </div>
            <div className="row" style={{ marginTop: 14, justifyContent: "space-between" }}>
              <span className="mono">{role.key}</span>
              <div className="btn-row">
                {role.key !== "superadmin" ? (
                  <button className="btn btn-sm btn-ghost" onClick={() => startEdit(role)}>
                    编辑
                  </button>
                ) : null}
                {!role.is_system ? (
                  <button className="btn btn-sm btn-danger" onClick={() => remove(role)}
                    disabled={busy}>删除</button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
