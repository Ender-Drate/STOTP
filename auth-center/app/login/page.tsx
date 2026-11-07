import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/config";
import { safeNextPath } from "@/lib/http";
import { currentUser } from "@/lib/session";
import { LoginForm } from "@/app/components/AuthForms";
import { PasskeyLoginButton } from "@/app/components/PasskeyLoginButton";
import { listProviders } from "@/lib/login-providers";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const error = typeof params.error === "string" ? params.error : "";
  const user = await currentUser();
  if (user) redirect(next);
  const providers = listProviders(true);

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
        <h1 className="auth-title">登录账户</h1>
        <LoginForm next={next} initialError={error} />
        <PasskeyLoginButton next={next} />
        {providers.length ? (
          <div className="login-providers">
            <div className="login-divider"><span>或使用其他方式</span></div>
            <div className="provider-list">
              {providers.map((provider) => (
                <a key={provider.id} className="provider-btn"
                  href={`/api/oauth/start?provider=${encodeURIComponent(provider.key)}&next=${encodeURIComponent(next)}`}>
                  <span className="provider-icon">
                    {provider.icon_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={provider.icon_url} alt="" />
                    ) : provider.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>{provider.name}</span>
                </a>
              ))}
            </div>
          </div>
        ) : null}
        <div className="auth-foot">
          没有账号？{" "}
          <Link href={`/register?next=${encodeURIComponent(next)}`}>立即注册</Link>
        </div>
      </div>
    </div>
  );
}
