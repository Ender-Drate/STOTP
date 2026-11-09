"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CspDirective } from "@/lib/csp";

export function CspEditor({
  initial, defaults, totpEnabled,
}: {
  initial: CspDirective[];
  defaults: CspDirective[];
  totpEnabled: boolean;
}) {
  const router = useRouter();
  const [directives, setDirectives] = useState<CspDirective[]>(initial);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function update(index: number, patch: Partial<CspDirective>) {
    setDirectives((current) => current.map((item, i) => (
      i === index ? { ...item, ...patch } : item
    )));
  }

  function addDirective() {
    setDirectives((current) => [...current, { name: "img-src", sources: ["'self'"] }]);
  }

  function removeDirective(index: number) {
    setDirectives((current) => current.filter((_, i) => i !== index));
  }

  function addSource(index: number) {
    update(index, { sources: [...directives[index].sources, ""] });
  }

  function removeSource(index: number, sourceIndex: number) {
    update(index, {
      sources: directives[index].sources.filter((_, i) => i !== sourceIndex),
    });
  }

  async function save() {
    if (!totpEnabled) {
      setMsg({ ok: false, text: "请先在设置中绑定 TOTP" });
      return;
    }
    if (!confirm("保存后立即生效。错误的 CSP 可能导致页面脚本/样式无法加载，确定保存？")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/developer/csp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directives, code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error?.message || "保存失败" });
        return;
      }
      setDirectives(data.directives || directives);
      setCode("");
      setMsg({ ok: true, text: "CSP 已保存并生效" });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "网络错误，请重试" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad">
      <div className="notice notice-error">
        CSP 直接影响浏览器加载脚本、样式、图片和表单。错误配置可能导致登录页或后台无法使用。
        修改和重置都需要当前 TOTP 动态码；保存前请确认内容。
      </div>
      {msg ? (
        <div className={`notice ${msg.ok ? "notice-ok" : "notice-error"}`}>{msg.text}</div>
      ) : null}
      {!totpEnabled ? (
        <div className="notice notice-error">
          当前账号未绑定 TOTP。请先前往 <Link href="/dashboard/settings">设置</Link> 绑定后再编辑。
        </div>
      ) : null}

      <div className="csp-editor">
        {directives.map((directive, index) => (
          <div className="csp-directive" key={index}>
            <div className="csp-directive-head">
              <input className="input mono" value={directive.name}
                aria-label="指令名"
                onChange={(e) => update(index, { name: e.target.value })} />
              <button type="button" className="btn btn-sm btn-danger"
                onClick={() => removeDirective(index)}>
                删除指令
              </button>
            </div>
            <div className="csp-sources">
              {directive.sources.map((source, sourceIndex) => (
                <div className="csp-source" key={sourceIndex}>
                  <input className="input mono" value={source}
                    aria-label={`${directive.name} 来源`}
                    onChange={(e) => {
                      const sources = [...directive.sources];
                      sources[sourceIndex] = e.target.value;
                      update(index, { sources });
                    }} />
                  <button type="button" className="btn btn-sm btn-ghost"
                    onClick={() => removeSource(index, sourceIndex)}>
                    删除
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-sm btn-ghost"
                onClick={() => addSource(index)}>
                + 来源
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="btn-row" style={{ marginTop: 14 }}>
        <button type="button" className="btn btn-ghost" onClick={addDirective}>
          + 添加指令
        </button>
        <button type="button" className="btn btn-ghost"
          onClick={() => setDirectives(defaults.map((item) => ({
            name: item.name, sources: [...item.sources],
          })))}>
          恢复默认值（需保存）
        </button>
      </div>

      <div className="csp-save">
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <label className="label">当前 TOTP 动态码</label>
          <input className="input otp-input" inputMode="numeric" autoComplete="one-time-code"
            maxLength={6} pattern="[0-9]{6}" value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000" />
        </div>
        <button type="button" className="btn btn-primary" onClick={save}
          disabled={busy || !totpEnabled || code.length !== 6}>
          {busy ? "保存中…" : "保存 CSP"}
        </button>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        `script-src` 中的 <code>{"{{nonce}}"}</code> 会由服务端替换为每个请求的 nonce；
        保存时至少会自动补回 nonce。其它指令和来源可以自由增删。
      </div>
    </div>
  );
}
