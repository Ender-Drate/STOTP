import { redirect } from "next/navigation";
import { getDb, type User } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { formatDateTime } from "@/lib/datetime";
import { hasPermission, isSuperAdmin } from "@/lib/permissions";
import { listRoles } from "@/lib/roles";
import { accountRisk } from "@/lib/account-risk";
import { UserActions } from "@/app/components/UserActions";

export const dynamic = "force-dynamic";

const LEVEL_TEXT: Record<string, string> = {
  low: "低", medium: "中", high: "高", critical: "严重",
};

function riskTone(level: string): string {
  if (level === "critical") return "pill-red";
  if (level === "high") return "pill-amber";
  if (level === "medium") return "pill-blue";
  return "pill-green";
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const me = await currentUser();
  if (!me) redirect("/login?next=/dashboard/users");
  if (!hasPermission(me, "users.view")) {
    return (
      <div className="card card-pad">
        <div className="card-title">需要权限</div>
        <p className="muted small" style={{ marginTop: 6 }}>当前权限等级不能查看用户列表。</p>
      </div>
    );
  }
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const users = (query
    ? getDb().prepare(
      `SELECT * FROM users
       WHERE username LIKE ? OR email LIKE ? OR display_name LIKE ?
       ORDER BY id DESC LIMIT 500`
    ).all(`%${query}%`, `%${query}%`, `%${query}%`)
    : getDb().prepare("SELECT * FROM users ORDER BY id DESC")
      .all()) as unknown as User[];
  const roles = listRoles();
  const roleById = new Map(roles.map((role) => [role.id, role]));

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">用户管理</h1>
          <p className="page-desc">{users.length} 个账号{query ? ` · 搜索「${query}」` : ""}</p>
        </div>
        <form className="row" style={{ gap: 8 }} action="/dashboard/users" method="get">
          <input className="input" name="q" defaultValue={query}
            placeholder="搜索用户名 / 邮箱 / 昵称" style={{ width: 230 }} />
          <button className="btn btn-primary btn-sm">搜索</button>
          {query ? <a className="btn btn-ghost btn-sm" href="/dashboard/users">清除</a> : null}
        </form>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>用户</th>
              <th>邮箱</th>
              <th>风控</th>
              <th>权限等级</th>
              <th>状态</th>
              <th>注册时间</th>
              <th style={{ width: 360 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const role = user.role_id ? roleById.get(user.role_id) : undefined;
              const risk = accountRisk(user, "", { ipScore: 0 });
              return (
                <tr key={user.id}>
                  <td className="num">{user.id}</td>
                  <td style={{ fontWeight: 600 }}>{user.display_name || user.username}</td>
                  <td className="muted">{user.email}</td>
                  <td title={risk.reasons.join("；")}>
                    <span className={`pill ${riskTone(risk.level)}`}>
                      {LEVEL_TEXT[risk.level]} · {risk.score}
                    </span>
                  </td>
                  <td>
                    <span className={`pill ${role?.key === "superadmin" ? "pill-blue" : ""}`}>
                      {role?.name || user.role}
                    </span>
                  </td>
                  <td>
                    <span className={`pill ${user.status === "active" ? "pill-green" : "pill-red"}`}>
                      {user.status === "active" ? "正常" : user.status === "pending" ? "待验证" : "已禁用"}
                    </span>
                  </td>
                  <td className="muted small">{formatDateTime(user.created_at)}</td>
                  <td>
                    <UserActions
                      userId={user.id}
                      roleId={user.role_id || 0}
                      status={user.status}
                      isSelf={user.id === me.id}
                      roles={roles.map((item) => ({
                        id: item.id, name: item.name, key: item.key,
                      }))}
                      canAssignRoles={isSuperAdmin(me)}
                      canDisable={hasPermission(me, "users.disable")}
                      canDelete={isSuperAdmin(me)}
                      canClearRisk={hasPermission(me, "risk.manage")}
                      riskScore={Number(user.risk_score) || 0}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
