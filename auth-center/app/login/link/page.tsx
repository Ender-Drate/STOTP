import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/config";
import { safeNextPath } from "@/lib/http";
import { LinkAccountForm } from "@/app/components/LinkAccountForm";

export const dynamic = "force-dynamic";

export default async function LinkAccountPage({
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
        <h1 className="auth-title">绑定本地账户</h1>
        <p className="auth-sub">该第三方账户首次登录，需要使用本地账户确认一次。</p>
        {error ? <div className="auth-error">{error}</div> : null}
        <LinkAccountForm ticket={ticket} next={next} />
        <div className="auth-foot">
          <Link href={`/login?next=${encodeURIComponent(next)}`}>返回登录</Link>
        </div>
      </div>
    </div>
  );
}
