"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PasswordInput } from "./PasswordInput";
import { encryptPassword } from "@/lib/password-client";

interface Props {
  user: {
    id: number;
    username: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
    role: string;
    createdAt: string;
  };
}

export function ProfileForms({ user }: Props) {
  const router = useRouter();
  const [profile, setProfile] = useState({
    displayName: user.displayName || "",
    email: user.email,
    avatarUrl: user.avatarUrl || "",
  });
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);

  const [password, setPassword] = useState({ current: "", next: "", confirm: "" });
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setProfileBusy(true);
    setProfileMsg(null);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setProfileMsg({ ok: false, text: data?.error?.message || "保存失败" });
        return;
      }
      setProfileMsg({ ok: true, text: "资料已更新" });
      router.refresh();
    } finally {
      setProfileBusy(false);
    }
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    if (password.next !== password.confirm) {
      setPasswordMsg({ ok: false, text: "两次输入的新密码不一致" });
      return;
    }
    setPasswordBusy(true);
    setPasswordMsg(null);
    try {
      let currentEnc;
      let nextEnc;
      try {
        currentEnc = await encryptPassword(password.current);
        nextEnc = await encryptPassword(password.next);
      } catch {
        setPasswordMsg({ ok: false, text: "当前环境无法加密密码，请使用 HTTPS 访问" });
        return;
      }
      const res = await fetch("/api/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword_enc: currentEnc.password_enc,
          newPassword_enc: nextEnc.password_enc,
          password_key: currentEnc.password_key,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setPasswordMsg({ ok: false, text: data?.error?.message || "修改失败" });
        return;
      }
      setPassword({ current: "", next: "", confirm: "" });
      setPasswordMsg({ ok: true, text: "密码已更新" });
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <div className="grid grid-2" style={{ gap: 16 }}>
      <form className="card card-pad" onSubmit={saveProfile}>
        <div className="card-title" style={{ marginBottom: 16 }}>个人资料</div>
        {profileMsg ? (
          <div className={`notice ${profileMsg.ok ? "notice-ok" : "notice-error"}`}>
            {profileMsg.text}
          </div>
        ) : null}
        <div className="field">
          <label className="label">昵称</label>
          <input className="input" value={profile.displayName}
            onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
            placeholder={user.username} />
        </div>
        <div className="field">
          <label className="label">邮箱</label>
          <input className="input" type="email" value={profile.email}
            onChange={(e) => setProfile({ ...profile, email: e.target.value })} required />
        </div>
        <div className="field">
          <label className="label">头像 URL（可选）</label>
          <input className="input" value={profile.avatarUrl}
            onChange={(e) => setProfile({ ...profile, avatarUrl: e.target.value })}
            placeholder="https://…" />
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={profileBusy}>
            {profileBusy ? "保存中…" : "保存资料"}
          </button>
        </div>
        <div className="divider" />
        <div className="small muted">
          用户名 <span className="mono">{user.username}</span> · 注册于{" "}
          {new Date(user.createdAt).toLocaleString("zh-CN")}
        </div>
      </form>

      <form className="card card-pad" onSubmit={savePassword}>
        <div className="card-title" style={{ marginBottom: 16 }}>修改密码</div>
        {passwordMsg ? (
          <div className={`notice ${passwordMsg.ok ? "notice-ok" : "notice-error"}`}>
            {passwordMsg.text}
          </div>
        ) : null}
        <div className="field">
          <label className="label">当前密码</label>
          <PasswordInput id="current-password" value={password.current}
            onChange={(value) => setPassword({ ...password, current: value })}
            autoComplete="current-password" required />
        </div>
        <div className="field">
          <label className="label">新密码</label>
          <PasswordInput id="profile-new-password" value={password.next}
            onChange={(value) => setPassword({ ...password, next: value })}
            autoComplete="new-password" placeholder="至少 8 位" required />
        </div>
        <div className="field">
          <label className="label">确认新密码</label>
          <PasswordInput id="profile-confirm-password" value={password.confirm}
            onChange={(value) => setPassword({ ...password, confirm: value })}
            autoComplete="new-password" required />
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={passwordBusy}>
            {passwordBusy ? "更新中…" : "更新密码"}
          </button>
        </div>
      </form>
    </div>
  );
}
