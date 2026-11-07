import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { listProviders, providerView } from "@/lib/login-providers";
import { PUBLIC_URL } from "@/lib/config";
import { ProviderManager } from "@/app/components/ProviderManager";

export const dynamic = "force-dynamic";

export default async function LoginProvidersPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/dashboard/logins");
  if (!hasPermission(user, "login.providers.manage")) {
    return (
      <div className="card card-pad">
        <div className="card-title">需要权限</div>
        <p className="muted small" style={{ marginTop: 6 }}>当前权限等级不能管理登录服务。</p>
      </div>
    );
  }
  return (
    <ProviderManager
      providers={listProviders().map(providerView)}
      callbackUrl={`${PUBLIC_URL}/api/oauth/callback`}
    />
  );
}
