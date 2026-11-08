import { BRAND } from "@/lib/config";
import { ForgotPasswordForm } from "@/app/components/ForgotPasswordForm";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <img className="brand-mark" src="/icon.svg" alt="" width={30} height={30} />
          <div>
            <div className="brand-name">{BRAND.name}</div>
            <div className="card-sub">账号恢复</div>
          </div>
        </div>
        <h1 className="auth-title">找回密码</h1>
        <p className="auth-sub">
          输入注册邮箱。我们会发送一封 30 分钟内有效的重置链接。
        </p>
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
