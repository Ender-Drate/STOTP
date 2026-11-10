import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/config";
import { safeNextPath } from "@/lib/http";
import { currentUser } from "@/lib/session";
import { LoginForm } from "@/app/components/AuthForms";
import { PasskeyLoginButton } from "@/app/components/PasskeyLoginButton";
import { ProviderIcon } from "@/app/components/ProviderIcon";
import { listProviders } from "@/lib/login-providers";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string | string[]; error?: string | string[]; verified?: string | string[];
    reset?: string | string[]; emailChanged?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const error = typeof params.error === "string" ? params.error : "";
  const verified = params.verified === "1";
  const reset = params.reset === "1";
  const emailChanged = params.emailChanged === "1";
  const user = await currentUser();
  if (user) redirect(next);
  const providers = listProviders(true);

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <img className="brand-mark" src="/icon.svg" alt="" width={30} height={30} />
          <div>
            <div className="brand-name">{BRAND.name}</div>
            <div className="card-sub">统一登录中心</div>
          </div>
        </div>
        <h1 className="auth-title">登录账户</h1>
        {emailChanged ? <div className="notice notice-ok">邮箱已修改，请重新登录并验证新邮箱。</div> : null}
        {reset ? <div className="notice notice-ok">密码已重置，请使用新密码登录。</div> : null}
        <LoginForm next={next} initialError={error} verified={verified} />
        <PasskeyLoginButton next={next} />
        {providers.length ? (
          <div className="login-providers">
            <div className="login-divider"><span>或使用其他方式</span></div>
            <div className="provider-list">
              {providers.map((provider) => (
                <a key={provider.id} className="provider-btn"
                  href={`/api/oauth/start?provider=${encodeURIComponent(provider.key)}&next=${encodeURIComponent(next)}`}>
                  <ProviderIcon iconUrl={provider.icon_url} name={provider.name} fallback={provider.key} />
                  <span>{provider.name}</span>
                </a>
              ))}
            </div>
          </div>
        ) : null}
        <div className="auth-foot">
          没有账号？{" "}
          <Link href={`/register?next=${encodeURIComponent(next)}`}>立即注册</Link>
          <span className="auth-foot-sep">·</span>
          <Link href={`/forgot-password?next=${encodeURIComponent(next)}`}>忘记密码？</Link>
        </div>
      </div>
    </div>
  );
}
