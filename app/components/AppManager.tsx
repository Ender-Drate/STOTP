"use client";

import { useState } from "react";
import type { ClientView } from "@/lib/clients";
import { CopyButton } from "./CopyButton";
import { Icon } from "./Icon";
import { uiText } from "@/lib/ui-i18n";

const ALL_SCOPES = ["openid", "profile", "email", "head", "permission", "offline_access"];

interface FormState {
  name: string;
  description: string;
  redirects: string;
  scopes: string[];
  isPublic: boolean;
}

const emptyForm: FormState = {
  name: "",
  description: "",
  redirects: "https://app.example.com/callback",
  scopes: ["openid", "profile", "email"],
  isPublic: false,
};

function messageOf(payload: unknown, fallback: string): string {
  const data = payload as { error?: { message?: string } } | null;
  return data?.error?.message || fallback;
}

export function AppManager({ initialClients }: { initialClients: ClientView[] }) {
  const [clients, setClients] = useState(initialClients);
  const [mode, setMode] = useState<"create" | "edit" | null>(null);
  const [editing, setEditing] = useState<ClientView | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setMode("create");
    setError("");
    setSecret("");
  }

  function openEdit(client: ClientView) {
    setEditing(client);
    setForm({
      name: client.name,
      description: client.description || "",
      redirects: client.redirectUris.join("\n"),
      scopes: client.scopes,
      isPublic: client.isPublic,
    });
    setMode("edit");
    setError("");
    setSecret("");
  }

  function toggleScope(scope: string) {
    setForm((prev) => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter((item) => item !== scope)
        : [...prev.scopes, scope],
    }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        name: form.name,
        description: form.description,
        redirectUris: form.redirects.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
        scopes: form.scopes,
        isPublic: form.isPublic,
      };
      const res = await fetch(
        mode === "edit" && editing ? `/api/admin/apps/${editing.id}` : "/api/admin/apps",
        {
          method: mode === "edit" ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(messageOf(data, "保存失败"));
        return;
      }
      const saved = data.client as ClientView;
      setClients((prev) => {
        const others = prev.filter((item) => item.id !== saved.id);
        return [saved, ...others];
      });
      if (data.clientSecret) setSecret(data.clientSecret as string);
      setMode(null);
      setEditing(null);
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(client: ClientView) {
    const res = await fetch(`/api/admin/apps/${client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: client.status === "active" ? "disabled" : "active" }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(messageOf(data, "操作失败"));
      return;
    }
    setClients((prev) => prev.map((item) => item.id === client.id ? data.client : item));
  }

  async function rotate(client: ClientView) {
    if (!confirm(uiText(`重新生成「${client.name}」的 Client Secret？旧密钥立即失效。`))) return;
    const res = await fetch(`/api/admin/apps/${client.id}/secret`, { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(messageOf(data, "轮换失败"));
      return;
    }
    setSecret(data.clientSecret as string);
  }

  async function remove(client: ClientView) {
    if (!confirm(uiText(`删除「${client.name}」？相关授权与令牌会一并失效。`))) return;
    const res = await fetch(`/api/admin/apps/${client.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(messageOf(data, "删除失败"));
      return;
    }
    setClients((prev) => prev.filter((item) => item.id !== client.id));
  }

  return (
    <div className="stack">
      {secret ? (
        <div className="secret-box">
          <div className="spread">
            <div>
              <div style={{ fontWeight: 650, fontSize: 13 }}>Client Secret（仅显示这一次）</div>
              <div className="hint" style={{ color: "var(--warn)" }}>
                请立即保存到服务端配置；关闭后无法再次查看。
              </div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => setSecret("")}>关闭</button>
          </div>
          <div className="copy-field" style={{ marginTop: 10, background: "#fff" }}>
            <span className="mono" style={{ color: "var(--warn)" }}>{secret}</span>
            <CopyButton value={secret} />
          </div>
        </div>
      ) : null}

      <div className="spread">
        <div className="muted small">共 {clients.length} 个应用</div>
        <button className="btn btn-primary" onClick={openCreate}>
          <Icon name="plus" /> 添加应用
        </button>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      {mode ? (
        <form className="card card-pad" onSubmit={save}>
          <div className="card-title" style={{ marginBottom: 14 }}>
            {mode === "edit" ? "编辑应用" : "添加应用"}
          </div>
          <div className="field">
            <label className="label">应用名称</label>
            <input className="input" value={form.name} required
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例如：EnderCraft 登录站" />
          </div>
          <div className="field">
            <label className="label">应用描述</label>
            <input className="input" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="展示在用户授权页上的说明" />
          </div>
          <div className="field">
            <label className="label">回调地址（每行一个）</label>
            <textarea className="input" rows={3} value={form.redirects} required
              onChange={(e) => setForm({ ...form, redirects: e.target.value })}
              placeholder="https://app.example.com/callback" />
            <div className="hint">必须与授权请求中的 redirect_uri 完全一致；本地开发可用 http://localhost。</div>
          </div>
          <div className="field">
            <label className="label">授权范围</label>
            <div className="pills">
              {ALL_SCOPES.map((scope) => (
                <label className="pill" key={scope} style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={form.scopes.includes(scope)}
                    onChange={() => toggleScope(scope)} />
                  {scope}
                </label>
              ))}
            </div>
          </div>
          <label className="row small" style={{ color: "var(--muted)" }}>
            <input type="checkbox" checked={form.isPublic}
              onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} />
            公共客户端（无 Client Secret，必须使用 PKCE）
          </label>
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy} type="submit">
              {busy ? "保存中…" : "保存"}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setMode(null)}>
              取消
            </button>
          </div>
        </form>
      ) : null}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>应用</th>
              <th>Client ID</th>
              <th>授权范围</th>
              <th>状态</th>
              <th>注册时间</th>
              <th style={{ width: 180 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 ? (
              <tr><td colSpan={6} className="empty">还没有应用，点击「添加应用」开始接入。</td></tr>
            ) : clients.map((client) => (
              <tr key={client.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{client.name}</div>
                  <div className="muted small truncate">{client.description || "—"}</div>
                </td>
                <td>
                  <div className="row">
                    <span className="mono">{client.clientId.slice(0, 12)}…</span>
                    <CopyButton value={client.clientId} label="复制" />
                  </div>
                  {client.isPublic ? <span className="pill pill-amber">公共客户端</span> : null}
                </td>
                <td>
                  <div className="pills">
                    {client.scopes.map((scope) => <span className="pill pill-blue" key={scope}>{scope}</span>)}
                  </div>
                </td>
                <td>
                  <span className={`pill ${client.status === "active" ? "pill-green" : "pill-red"}`}>
                    {client.status === "active" ? "已启用" : "已禁用"}
                  </span>
                </td>
                <td className="muted small">{new Date(client.createdAt).toLocaleString("zh-CN")}</td>
                <td>
                  <div className="btn-row" style={{ flexWrap: "nowrap" }}>
                    <button className="btn-icon" title="编辑" onClick={() => openEdit(client)}>
                      <Icon name="edit" />
                    </button>
                    {!client.isPublic ? (
                      <button className="btn-icon" title="轮换密钥" onClick={() => rotate(client)}>
                        <Icon name="refresh" />
                      </button>
                    ) : null}
                    <button className="btn-icon" title={client.status === "active" ? "停用" : "启用"}
                      onClick={() => toggleStatus(client)}>
                      <Icon name="key" />
                    </button>
                    <button className="btn-icon" title="删除" onClick={() => remove(client)}
                      style={{ color: "var(--danger)" }}>
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
