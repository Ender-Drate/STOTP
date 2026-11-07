import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { formatDateTime } from "@/lib/datetime";
import { parseScopes } from "@/lib/oidc";
import { RevokeConsentButton } from "@/app/components/RevokeConsentButton";

export const dynamic = "force-dynamic";

export default async function AuthorizationsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/dashboard/authorizations");

  const rows = getDb().prepare(
    `SELECT c.client_id, c.name, c.description, s.scope, s.created_at
     FROM consents s JOIN oauth_clients c ON c.client_id = s.client_id
     WHERE s.user_id = ? ORDER BY s.created_at DESC`
  ).all(user.id) as unknown as Array<{
    client_id: string; name: string; description: string | null;
    scope: string; created_at: string;
  }>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">我的授权</h1>
          <p className="page-desc">管理已同意访问你账号的应用</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card empty">
          <div className="empty-title">还没有授权任何应用</div>
          <div className="small">当你登录第三方应用并同意授权后，会显示在这里。</div>
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>应用</th>
                <th>授权范围</th>
                <th>授权时间</th>
                <th style={{ width: 90 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.client_id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{row.name}</div>
                    <div className="muted small truncate">{row.description || row.client_id}</div>
                  </td>
                  <td>
                    <div className="pills">
                      {parseScopes(row.scope).map((scope) => (
                        <span className="pill pill-blue" key={scope}>{scope}</span>
                      ))}
                    </div>
                  </td>
                  <td className="muted small">{formatDateTime(row.created_at)}</td>
                  <td><RevokeConsentButton clientId={row.client_id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
