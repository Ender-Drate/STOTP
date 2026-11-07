"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission?: string;
  superOnly?: boolean;
}

const groups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "主菜单",
    items: [
      { href: "/dashboard", label: "概览", icon: "overview" },
      {
        href: "/dashboard/apps", label: "OAuth2 应用", icon: "apps",
        permission: "oauth.apps.manage",
      },
      {
        href: "/dashboard/logins", label: "登录入口", icon: "shield",
        permission: "login.providers.manage",
      },
      { href: "/dashboard/authorizations", label: "我的授权", icon: "authz" },
      {
        href: "/dashboard/users", label: "用户管理", icon: "users",
        permission: "users.view",
      },
      { href: "/dashboard/roles", label: "权限", icon: "shield", superOnly: true },
      { href: "/dashboard/settings", label: "设置", icon: "settings" },
    ],
  },
  {
    label: "开发",
    items: [{ href: "/docs", label: "接入文档", icon: "docs" }],
  },
];

export function SidebarNav({
  permissions, isSuper,
}: {
  permissions: string[];
  isSuper: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="nav-label">{group.label}</div>
          {group.items
            .filter((item) => {
              if (item.superOnly) return isSuper;
              if (!item.permission) return true;
              return permissions.includes(item.permission);
            })
            .map((item) => {
              const active = pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item${active ? " active" : ""}`}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </Link>
              );
            })}
        </div>
      ))}
    </nav>
  );
}
