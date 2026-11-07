import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { safeNextPath } from "@/lib/http";
import { ResendVerificationForm } from "@/app/components/ResendVerificationForm";

export const dynamic = "force-dynamic";

export default async function PendingPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string }>;
}) {
  const user = await currentUser();
  if (user) redirect("/dashboard");
  const params = await searchParams;
  const email = params.email || "";
  const next = safeNextPath(params.next);

  return (
    <div className="auth-page">
      <div className="auth-card card card-pad">
        <h1 className="auth-title">验证你的邮箱</h1>
        <p className="auth-sub">
          验证邮件已发送到 <span className="mono">{email || "你的邮箱"}</span>。
          打开邮件中的链接后即可登录，链接 24 小时内有效。
        </p>
        <ResendVerificationForm defaultEmail={email} />
        <p className="auth-foot">
          <Link href={`/login?next=${encodeURIComponent(next)}`}>已验证，去登录</Link>
        </p>
      </div>
    </div>
  );
}
