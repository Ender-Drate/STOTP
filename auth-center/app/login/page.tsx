import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/config";
import { currentUser } from "@/lib/session";
import { LoginForm } from "@/app/components/AuthForms";

export const dynamic = "force-dynamic";

function safeNext(value: string | string[] | undefined): string {
  const next = Array.isArray(value) ? value[0] : value;
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/dashboard";
  return next;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const user = await currentUser();
  if (user) redirect(next);

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">S</div>
          <div>
            <div className="brand-name">{BRAND.name}</div>
            <div className="card-sub">统一登录中心</div>
          </div>
        </div>
        <h1 className="auth-title">登录你的账号</h1>
        <p className="auth-sub">输入用户名和密码继续</p>
        <LoginForm next={next} />
        <div className="auth-foot">
          没有账号？ <Link href="/register">立即注册</Link>
        </div>
      </div>
    </div>
  );
}
