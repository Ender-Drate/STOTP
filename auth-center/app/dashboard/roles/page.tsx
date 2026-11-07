import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { listRoles } from "@/lib/roles";
import { RoleManager } from "@/app/components/RoleManager";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/dashboard/roles");
  if (!isSuperAdmin(user)) {
    return (
      <div className="card card-pad">
        <div className="card-title">需要最高管理员权限</div>
        <p className="muted small" style={{ marginTop: 6 }}>只有最高管理员可以管理权限等级。</p>
      </div>
    );
  }
  return <RoleManager roles={listRoles()} />;
}
