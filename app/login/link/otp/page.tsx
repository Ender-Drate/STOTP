import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/config";
import { safeNextPath } from "@/lib/http";
import { LinkOtpForm } from "@/app/components/LinkOtpForm";

export const dynamic = "force-dynamic";

export default async function LinkOtpPage({
  searchParams,
}: {
  searchParams: Promise<{
    ticket?: string | string[];
    next?: string | string[];
    error?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const ticket = typeof params.ticket === "string" ? params.ticket : "";
  const next = safeNextPath(params.next);
  const error = typeof params.error === "string" ? params.error : "";
  if (!ticket) redirect("/login");

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <img className="brand-mark" src="/icon.svg" alt="" width={30} height={30} />
          <div>
            <div className="brand-name">{BRAND.name}</div>
            <div className="card-sub">账户绑定</div>
          </div>
        </div>
        <h1 className="auth-title">验证本地账户</h1>
        <p className="auth-sub">该账号启用了 TOTP，请输入动态验证码完成绑定。</p>
        {error ? <div className="auth-error">{error}</div> : null}
        <LinkOtpForm ticket={ticket} next={next} />
        <div className="auth-foot">
          <Link href={`/login/link?ticket=${encodeURIComponent(ticket)}&next=${encodeURIComponent(next)}`}>
            返回绑定页
          </Link>
        </div>
      </div>
    </div>
  );
}
