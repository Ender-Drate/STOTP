import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/config";
import { safeNextPath } from "@/lib/http";
import { currentUser } from "@/lib/session";
import { RegisterForm } from "@/app/components/AuthForms";

export const dynamic = "force-dynamic";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const error = typeof params.error === "string" ? params.error : "";
  const user = await currentUser();
  if (user) redirect(next);

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
        <RegisterForm next={next} initialError={error} />
        <div className="auth-foot">
          已有账号？{" "}
          <Link href={`/login?next=${encodeURIComponent(next)}`}>去登录</Link>
        </div>
      </div>
    </div>
  );
}
