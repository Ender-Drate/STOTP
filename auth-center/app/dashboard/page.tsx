import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { getDb } from "@/lib/db";
import { parseScopes } from "@/lib/oidc";
import { hasPermission, isSuperAdmin, permissionsOf, roleNameOf } from "@/lib/permissions";

export const dynamic = "force-dynamic";

function count(sql: string, ...params: Array<string | number>): number {
  return (getDb().prepare(sql).get(...params) as { c: number }).c;
}

export default async function OverviewPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/dashboard");

  const today = new Date().toISOString().slice(0, 10);
  const users = count("SELECT COUNT(*) AS c FROM users");
  const clients = count("SELECT COUNT(*) AS c FROM oauth_clients WHERE status = 'active'");
  const todayLogins = count(
    "SELECT COUNT(*) AS c FROM audit WHERE event = 'login' AND ts LIKE ?", `${today}%`
  );
  const myConsents = count(
    "SELECT COUNT(*) AS c FROM consents WHERE user_id = ?", user.id
  );
  const recent = getDb().prepare(
    `SELECT event, ts FROM audit WHERE user_id = ? ORDER BY id DESC LIMIT 6`
  ).all(user.id) as unknown as Array<{ event: string; ts: string }>;
  const permissions = permissionsOf(user);
  const roleName = roleNameOf(user);
  const name = user.display_name || user.username;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">概览</h1>
          <p className="page-desc">账号状态、接入应用与近期活动</p>
        </div>
        <Link className="btn btn-ghost" href="/docs">接入文档</Link>
      </div>

      <div className="stack">
        <div className="card card-pad">
          <div className="row">
            <div className="avatar" style={{ width: 46, height: 46, fontSize: 16 }}>
              {user.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatar_url} alt="" />
              ) : name.slice(0, 1).toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em" }}>
                当前账户：{name}
              </div>
              <div className="muted small">{user.email}</div>
            </div>
            <span className={`pill ${isSuperAdmin(user) ? "pill-blue" : ""}`}>
              {isSuperAdmin(user) ? "最高管理员" : roleName}
            </span>
          </div>
        </div>

        <div className="grid grid-4">
          <div className="card stat">
            <div className="stat-label">用户总数</div>
            <div className="stat-value">{users}</div>
          </div>
          <div className="card stat">
            <div className="stat-label">已接入应用</div>
            <div className="stat-value">{clients}</div>
          </div>
          <div className="card stat">
            <div className="stat-label">我的授权</div>
            <div className="stat-value">{myConsents}</div>
          </div>
          <div className="card stat">
            <div className="stat-label">今日登录</div>
            <div className="stat-value">{todayLogins}</div>
          </div>
        </div>

        <div className="grid grid-2">
          <div className="card">
            <div className="card-head">
              <div className="card-title">账号信息</div>
              <Link className="btn btn-sm btn-ghost" href="/dashboard/settings">编辑</Link>
            </div>
            <table className="table">
              <tbody>
                <tr><td className="muted" style={{ width: 110 }}>用户名</td><td>{user.username}</td></tr>
                <tr><td className="muted">邮箱</td><td>{user.email}</td></tr>
                <tr><td className="muted">角色</td><td>{isSuperAdmin(user) ? "最高管理员" : roleName}</td></tr>
                <tr><td className="muted">状态</td><td><span className="pill pill-green">正常</span></td></tr>
                <tr>
                  <td className="muted">权限</td>
                  <td><div className="pills">{permissions.map((p) => <span className="pill" key={p}>{p}</span>)}</div></td>
                </tr>
                <tr><td className="muted">注册时间</td><td>{new Date(user.created_at).toLocaleString("zh-CN")}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title">近期活动</div>
            </div>
            <div className="card-pad">
              {recent.length === 0 ? (
                <div className="muted small">暂无活动</div>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {recent.map((item, index) => (
                    <li key={index} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderTop: index ? "1px solid var(--line)" : "none", fontSize: 12.5 }}>
                      <span>{{
                        login: "登录成功", login_failed: "登录失败", user_register: "注册账号",
                        profile_update: "更新资料", password_change: "修改密码",
                        consent_revoke: "撤销授权", client_create: "创建应用",
                        client_update: "更新应用", client_delete: "删除应用",
                        client_secret_rotate: "轮换密钥",
                      }[item.event] || item.event}</span>
                      <span className="muted small">{new Date(item.ts).toLocaleString("zh-CN")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="card card-pad">
          <div className="spread">
            <div>
              <div className="card-title">应用接入</div>
              <div className="muted small" style={{ marginTop: 3 }}>
                创建一个 OAuth2 应用，将 Client ID / Secret 与回调地址配置到目标系统。
              </div>
            </div>
            <div className="btn-row">
              {hasPermission(user, "oauth.apps.manage") ? (
                <Link className="btn btn-primary" href="/dashboard/apps">管理应用</Link>
              ) : null}
              <Link className="btn btn-ghost" href="/docs">查看文档</Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
