import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/config";
import { currentUser } from "@/lib/session";
import { SidebarNav } from "@/app/components/SidebarNav";
import { LogoutButton } from "@/app/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/dashboard");

  const name = user.display_name || user.username;
  return (
    <div className="app">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand" style={{ color: "inherit" }}>
          <div className="brand-mark">S</div>
          <div>
            <div className="brand-name">{BRAND.name}</div>
            <div className="card-sub">统一登录中心</div>
          </div>
        </Link>
        <SidebarNav isAdmin={user.role === "admin"} />
        <div className="sidebar-user">
          <div className="avatar">
            {user.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatar_url} alt="" />
            ) : name.slice(0, 1).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar-user-name truncate">{name}</div>
            <div className="sidebar-user-role">
              {user.role === "admin" ? "管理员" : "普通用户"}
            </div>
          </div>
          <LogoutButton />
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
