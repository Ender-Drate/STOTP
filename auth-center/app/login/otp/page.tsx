import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/config";
import { safeNextPath } from "@/lib/http";
import { currentUser } from "@/lib/session";
import { OtpForm } from "@/app/components/AuthForms";

export const dynamic = "force-dynamic";

export default async function LoginOtpPage({
  searchParams,
}: {
  searchParams: Promise<{
    ticket?: string | string[];
    next?: string | string[];
    error?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const ticket = typeof params.ticket === "string" ? params.ticket : "";
  const error = typeof params.error === "string" ? params.error : "";
  const user = await currentUser();
  if (user) redirect(next);
  if (!ticket) redirect(`/login?next=${encodeURIComponent(next)}`);

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">S</div>
          <div>
            <div className="brand-name">{BRAND.name}</div>
            <div className="card-sub">两步验证</div>
          </div>
        </div>
        <h1 className="auth-title">输入动态验证码</h1>
        <p className="auth-sub">密码已验证，最后确认你的设备</p>
        <OtpForm ticket={ticket} next={next} initialError={error} />
        <div className="auth-foot">
          <Link href={`/login?next=${encodeURIComponent(next)}`}>返回重新登录</Link>
        </div>
      </div>
    </div>
  );
}
