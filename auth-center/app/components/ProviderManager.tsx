"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CopyButton } from "./CopyButton";

interface ProviderView {
  id: number;
  key: string;
  name: string;
  iconUrl: string | null;
  clientId: string;
  hasSecret: boolean;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string;
  enabled: boolean;
}

interface Draft {
  id: number | null;
  name: string;
  iconUrl: string;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string;
  enabled: boolean;
}

const emptyDraft: Draft = {
  id: null, name: "", iconUrl: "", clientId: "", clientSecret: "",
  authorizationUrl: "", tokenUrl: "", userinfoUrl: "",
  scopes: "openid profile email", enabled: true,
};

export function ProviderManager({
  providers, callbackUrl,
}: {
  providers: ProviderView[];
  callbackUrl: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function startCreate() {
    setMsg(null);
    setDraft({ ...emptyDraft });
  }

  function startEdit(provider: ProviderView) {
    setMsg(null);
    setDraft({
      id: provider.id,
      name: provider.name,
      iconUrl: provider.iconUrl || "",
      clientId: provider.clientId,
      clientSecret: "",
      authorizationUrl: provider.authorizationUrl,
      tokenUrl: provider.tokenUrl,
      userinfoUrl: provider.userinfoUrl,
      scopes: provider.scopes,
      enabled: provider.enabled,
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(
        draft.id ? `/api/admin/logins/${draft.id}` : "/api/admin/logins",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.name,
            iconUrl: draft.iconUrl,
            clientId: draft.clientId,
            clientSecret: draft.clientSecret || undefined,
            authorizationUrl: draft.authorizationUrl,
            tokenUrl: draft.tokenUrl,
            userinfoUrl: draft.userinfoUrl,
            scopes: draft.scopes,
            enabled: draft.enabled,
          }),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error?.message || "保存失败" });
        return;
      }
      setDraft(null);
      setMsg({ ok: true, text: "登录服务已保存" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(provider: ProviderView) {
    if (!confirm(`删除登录服务「${provider.name}」？`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/logins/${provider.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setMsg({ ok: false, text: data?.error?.message || "删除失败" });
        return;
      }
      setMsg({ ok: true, text: "登录服务已删除" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">登录入口</h1>
          <p className="page-desc">接入外部 OAuth2 登录服务，并显示在登录页</p>
        </div>
        <button className="btn btn-primary" onClick={startCreate}>添加登录服务</button>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="label">回调地址（配置到第三方服务）</div>
        <div className="copy-field" style={{ marginTop: 6 }}>
          <span className="mono">{callbackUrl}</span>
          <CopyButton value={callbackUrl} />
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          第三方服务需返回 <code>sub</code>（或 <code>id</code>）；首次登录需使用本地账户完成绑定。
        </p>
      </div>

      {msg ? (
        <div className={`notice ${msg.ok ? "notice-ok" : "notice-error"}`}>{msg.text}</div>
      ) : null}

      {draft ? (
        <form className="card card-pad" onSubmit={save} style={{ marginBottom: 16 }}>
          <div className="spread" style={{ marginBottom: 14 }}>
            <div className="card-title">{draft.id ? "编辑登录服务" : "添加登录服务"}</div>
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => setDraft(null)}>取消</button>
          </div>
          <div className="grid grid-2" style={{ gap: 14 }}>
            <div className="field">
              <label className="label">名称</label>
              <input className="input" value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="例如：第三方登录服务" required />
            </div>
            <div className="field">
              <label className="label">图标 URL（可选）</label>
              <input className="input" value={draft.iconUrl}
                onChange={(e) => setDraft({ ...draft, iconUrl: e.target.value })}
                placeholder="https://…/logo.png" />
            </div>
            <div className="field">
              <label className="label">Client ID</label>
              <input className="input mono" value={draft.clientId}
                onChange={(e) => setDraft({ ...draft, clientId: e.target.value })} required />
            </div>
            <div className="field">
              <label className="label">Client Secret</label>
              <input className="input mono" type="password" value={draft.clientSecret}
                onChange={(e) => setDraft({ ...draft, clientSecret: e.target.value })}
                placeholder={draft.id ? "留空表示不修改" : ""}
                required={!draft.id} />
            </div>
            <div className="field">
              <label className="label">授权地址</label>
              <input className="input" value={draft.authorizationUrl}
                onChange={(e) => setDraft({ ...draft, authorizationUrl: e.target.value })}
                placeholder="https://friend.example.com/oauth/authorize" required />
            </div>
            <div className="field">
              <label className="label">Token 地址</label>
              <input className="input" value={draft.tokenUrl}
                onChange={(e) => setDraft({ ...draft, tokenUrl: e.target.value })}
                placeholder="https://friend.example.com/oauth/token" required />
            </div>
            <div className="field">
              <label className="label">UserInfo 地址</label>
              <input className="input" value={draft.userinfoUrl}
                onChange={(e) => setDraft({ ...draft, userinfoUrl: e.target.value })}
                placeholder="https://friend.example.com/oauth/userinfo" required />
            </div>
            <div className="field">
              <label className="label">Scope</label>
              <input className="input" value={draft.scopes}
                onChange={(e) => setDraft({ ...draft, scopes: e.target.value })} />
            </div>
          </div>
          <label className="row" style={{ fontSize: 12.5 }}>
            <input type="checkbox" checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
            在登录页显示
          </label>
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "保存中…" : "保存登录服务"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="provider-grid">
        {providers.map((provider) => (
          <div className="card card-pad provider-card" key={provider.id}>
            <div className="row" style={{ gap: 12 }}>
              <div className="provider-icon">
                {provider.iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={provider.iconUrl} alt="" />
                ) : provider.name.slice(0, 1).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="card-title truncate">{provider.name}</div>
                <div className="muted small truncate">{provider.clientId}</div>
              </div>
              <span className={`pill ${provider.enabled ? "pill-green" : ""}`}>
                {provider.enabled ? "启用" : "停用"}
              </span>
            </div>
            <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
              <button className="btn btn-sm btn-ghost" onClick={() => startEdit(provider)}>编辑</button>
              <button className="btn btn-sm btn-danger" onClick={() => remove(provider)}
                disabled={busy}>删除</button>
            </div>
          </div>
        ))}
        {providers.length === 0 ? (
          <div className="card card-pad" style={{ gridColumn: "1 / -1" }}>
            <div className="empty">
              <div className="empty-title">还没有外部登录服务</div>
              <div className="small">使用右上角「添加登录服务」接入外部 OAuth2 服务。</div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
