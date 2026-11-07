import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/config";
import { currentUser } from "@/lib/session";
import { safeNextPath } from "@/lib/http";
import { ResendVerificationForm } from "@/app/components/ResendVerificationForm";

export const dynamic = "force-dynamic";

export default async function PendingPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string; mail?: string }>;
}) {
  const user = await currentUser();
  if (user) redirect("/dashboard");
  const params = await searchParams;
  const email = params.email || "";
  const next = safeNextPath(params.next);
  const mailFailed = params.mail === "failed";

  return (
    <div className="auth-wrap">
      <div className="auth-card verify-card">
        <div className="auth-brand">
          <img className="brand-mark" src="/icon.svg" alt="" width={30} height={30} />
          <div>
            <div className="brand-name">{BRAND.name}</div>
            <div className="card-sub">邮箱验证</div>
          </div>
        </div>

        <div className="verify-icon" aria-hidden="true">✉</div>
        <h1 className="auth-title">检查你的邮箱</h1>
        <p className="auth-sub" style={{ marginBottom: 16 }}>
          验证链接已发送到
        </p>
        <div className="verify-email mono">{email || "你的注册邮箱"}</div>
        {mailFailed ? (
          <div className="notice notice-error" style={{ textAlign: "left" }}>
            验证邮件发送失败，请点击下方按钮重发，或联系管理员检查 SMTP。
          </div>
        ) : null}

        <div className="verify-steps">
          <div className="verify-step">
            <span className="verify-step-num">1</span>
            <span>打开邮件，点击验证链接</span>
          </div>
          <div className="verify-step">
            <span className="verify-step-num">2</span>
            <span>链接 24 小时内有效，且只能使用一次</span>
          </div>
          <div className="verify-step">
            <span className="verify-step-num">3</span>
            <span>验证完成后回来登录</span>
          </div>
        </div>

        <ResendVerificationForm defaultEmail={email} />

        <div className="auth-foot">
          邮箱填错了？<Link href="/register">重新注册</Link>
          <span className="auth-foot-sep">·</span>
          <Link href={`/login?next=${encodeURIComponent(next)}`}>返回登录</Link>
        </div>
      </div>
    </div>
  );
}
