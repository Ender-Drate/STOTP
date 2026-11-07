import { redirect } from "next/navigation";
import { getDb, type User } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { hasPermission, isSuperAdmin } from "@/lib/permissions";
import { listRoles } from "@/lib/roles";
import { UserActions } from "@/app/components/UserActions";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
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
  const users = getDb().prepare("SELECT * FROM users ORDER BY id DESC")
    .all() as unknown as User[];
  const roles = listRoles();
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const bindings = new Set<number>();
  for (const row of getDb().prepare(
    "SELECT user_id FROM stotp_bindings WHERE status = 'active'"
  ).all() as Array<{ user_id: number }>) {
    bindings.add(row.user_id);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">用户管理</h1>
          <p className="page-desc">{users.length} 个账号 · 调整权限等级与状态</p>
        </div>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>用户</th>
              <th>邮箱</th>
              <th>STOTP</th>
              <th>权限等级</th>
              <th>状态</th>
              <th>注册时间</th>
              <th style={{ width: 360 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const role = user.role_id ? roleById.get(user.role_id) : undefined;
              return (
                <tr key={user.id}>
                  <td className="num">{user.id}</td>
                  <td style={{ fontWeight: 600 }}>{user.display_name || user.username}</td>
                  <td className="muted">{user.email}</td>
                  <td>
                    {bindings.has(user.id) ? (
                      <span className="pill pill-green">已绑定</span>
                    ) : (
                      <span className="pill">未绑定</span>
                    )}
                  </td>
                  <td>
                    <span className={`pill ${role?.key === "superadmin" ? "pill-blue" : ""}`}>
                      {role?.name || user.role}
                    </span>
                  </td>
                  <td>
                    <span className={`pill ${user.status === "active" ? "pill-green" : "pill-red"}`}>
                      {user.status === "active" ? "正常" : "已禁用"}
                    </span>
                  </td>
                  <td className="muted small">{new Date(user.created_at).toLocaleString("zh-CN")}</td>
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
                      canManageStotp={hasPermission(me, "stotp.manage")}
                      stotpBound={bindings.has(user.id)}
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
