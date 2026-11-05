import { redirect } from "next/navigation";
import { getDb, type User } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { UserActions } from "@/app/components/UserActions";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await currentUser();
  if (!me) redirect("/login?next=/dashboard/users");
  if (me.role !== "admin") {
    return (
      <div className="card card-pad">
        <div className="card-title">需要管理员权限</div>
        <p className="muted small" style={{ marginTop: 6 }}>只有管理员可以查看用户列表。</p>
      </div>
    );
  }
  const users = getDb().prepare("SELECT * FROM users ORDER BY id DESC")
    .all() as unknown as User[];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">用户管理</h1>
          <p className="page-desc">{users.length} 个账号 · 调整角色与状态</p>
        </div>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>用户</th>
              <th>邮箱</th>
              <th>角色</th>
              <th>状态</th>
              <th>注册时间</th>
              <th style={{ width: 210 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td className="num">{user.id}</td>
                <td style={{ fontWeight: 600 }}>{user.display_name || user.username}</td>
                <td className="muted">{user.email}</td>
                <td>
                  <span className={`pill ${user.role === "admin" ? "pill-blue" : ""}`}>
                    {user.role === "admin" ? "管理员" : "普通用户"}
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
                    role={user.role}
                    status={user.status}
                    isSelf={user.id === me.id}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
