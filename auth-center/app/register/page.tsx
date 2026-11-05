import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/config";
import { currentUser } from "@/lib/session";
import { RegisterForm } from "@/app/components/AuthForms";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const user = await currentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">S</div>
          <div>
            <div className="brand-name">{BRAND.name}</div>
            <div className="card-sub">创建新账号</div>
          </div>
        </div>
        <h1 className="auth-title">注册</h1>
        <p className="auth-sub">一个账号，登录所有接入的应用</p>
        <RegisterForm />
        <div className="auth-foot">
          已有账号？ <Link href="/login">去登录</Link>
        </div>
      </div>
    </div>
  );
}
