import Link from "next/link";
import { findUserById } from "@/lib/db";
import { peekPasswordReset } from "@/lib/password-reset";
import { BRAND } from "@/lib/config";
import { ResetPasswordForm } from "@/app/components/ResetPasswordForm";

export const dynamic = "force-dynamic";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <img className="brand-mark" src="/icon.svg" alt="" width={30} height={30} />
          <div>
            <div className="brand-name">{BRAND.name}</div>
            <div className="card-sub">密码重置</div>
          </div>
        </div>
        <h1 className="auth-title">{title}</h1>
        {children}
      </div>
    </div>
  );
}

function maskedEmail(value: string): string {
  const [name, domain] = value.split("@");
  if (!domain) return value;
  return `${name.slice(0, 2)}***@${domain}`;
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token || "";
  const record = peekPasswordReset(token);
  if (!record) {
    return (
      <Shell title="链接无效或已过期">
        <p className="auth-sub">请重新发起找回密码，或联系管理员。</p>
        <Link className="btn btn-primary" href="/forgot-password">重新找回密码</Link>
      </Shell>
    );
  }
  const user = findUserById(record.user_id);
  if (!user || user.status !== "active") {
    return (
      <Shell title="无法重置">
        <p className="auth-sub">账号不存在或当前不可用，请联系管理员。</p>
        <Link className="btn btn-ghost" href="/login">返回登录</Link>
      </Shell>
    );
  }
  const highRisk = record.risk_level === "high" || record.risk_level === "critical";
  const requiresTotp = highRisk && Boolean(user.totp_secret);
  const requiresCaptcha = highRisk && !user.totp_secret;

  return (
    <Shell title="设置新密码">
      <p className="auth-sub">
        正在为 <strong>{maskedEmail(user.email)}</strong> 设置新密码。
      </p>
      {highRisk ? (
        <div className="notice notice-error">
          本次请求风险等级：{record.risk_level}。
          {requiresTotp ? "需要额外的 TOTP 动态码确认。" : "需要额外的图形验证码确认。"}
        </div>
      ) : null}
      <ResetPasswordForm
        token={token}
        requiresTotp={requiresTotp}
        requiresCaptcha={requiresCaptcha}
      />
      <div className="auth-foot">
        <Link href="/login">返回登录</Link>
      </div>
    </Shell>
  );
}
