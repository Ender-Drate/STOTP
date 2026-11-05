import { redirect } from "next/navigation";
import { getDb, type OAuthClient } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { serializeClient } from "@/lib/clients";
import { AppManager } from "@/app/components/AppManager";

export const dynamic = "force-dynamic";

export default async function AppsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/dashboard/apps");
  if (user.role !== "admin") {
    return (
      <div className="card card-pad">
        <div className="card-title">需要管理员权限</div>
        <p className="muted small" style={{ marginTop: 6 }}>只有管理员可以管理 OAuth2 应用。</p>
      </div>
    );
  }
  const rows = getDb().prepare(
    "SELECT * FROM oauth_clients ORDER BY id DESC"
  ).all() as unknown as OAuthClient[];
  const clients = rows.map(serializeClient);
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">OAuth2 应用</h1>
          <p className="page-desc">第三方系统凭 Client ID / Secret 与回调地址接入本站</p>
        </div>
      </div>
      <AppManager initialClients={clients} />
    </>
  );
}
